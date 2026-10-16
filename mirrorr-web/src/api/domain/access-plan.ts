import {
  grantResourceViewer,
  revokeResourceViewer,
  setResourceOwner,
} from "@/api/endpoints/access"
import { getErrorMessage } from "@/api/domain/errors"

/** One item's access as the admin API reports it. */
export interface ItemAccess {
  readonly owner: string
  readonly viewers: readonly string[]
}

/** What an edit asks for — an absent field is left exactly as it is. */
export interface AccessTarget {
  readonly owner?: string
  readonly viewers?: readonly string[]
}

export type AccessOp =
  | { readonly kind: "owner"; readonly username: string }
  | { readonly kind: "grant"; readonly username: string }
  | { readonly kind: "revoke"; readonly username: string }

/**
 * Why an item counts as carrying its own access. Both kinds are what the core
 * can prove: `PUT …/owner` overwrites `requester_user_token`, so a past
 * transfer leaves no trace, while a deleted owner account and the explicit
 * grant rows both survive as data.
 */
export type AccessOverride =
  | { readonly kind: "owner-missing" }
  | { readonly kind: "grants"; readonly count: number }

export interface ItemPlan {
  readonly resourceType: string
  readonly id: number
  readonly label: string
  readonly from: ItemAccess
  readonly to: ItemAccess
  readonly ops: readonly AccessOp[]
  readonly override: AccessOverride | null
}

export interface BulkPlan {
  readonly items: readonly ItemPlan[]
  readonly opCount: number
  /** Items whose own access a change would overwrite — the confirm gate. */
  readonly overriding: readonly ItemPlan[]
}

export interface AccessRow {
  readonly resourceType: string
  readonly id: number
  readonly label: string
  readonly access: ItemAccess
}

export function overrideOf(access: ItemAccess, users: readonly string[]): AccessOverride | null {
  if (access.owner !== "" && !users.includes(access.owner)) return { kind: "owner-missing" }
  if (access.viewers.length > 0) return { kind: "grants", count: access.viewers.length }
  return null
}

export function planItem(row: AccessRow, target: AccessTarget, users: readonly string[]): ItemPlan {
  const to: ItemAccess = {
    owner: target.owner ?? row.access.owner,
    viewers: target.viewers ?? row.access.viewers,
  }
  const ops: AccessOp[] = []
  if (to.owner !== row.access.owner) ops.push({ kind: "owner", username: to.owner })
  for (const username of to.viewers) {
    if (!row.access.viewers.includes(username)) ops.push({ kind: "grant", username })
  }
  for (const username of row.access.viewers) {
    if (!to.viewers.includes(username)) ops.push({ kind: "revoke", username })
  }
  return {
    resourceType: row.resourceType,
    id: row.id,
    label: row.label,
    from: row.access,
    to,
    ops,
    override: overrideOf(row.access, users),
  }
}

export function planBulk(
  rows: readonly AccessRow[],
  target: AccessTarget,
  users: readonly string[],
): BulkPlan {
  const items = rows.map((row) => planItem(row, target, users))
  return {
    items,
    opCount: items.reduce((total, item) => total + item.ops.length, 0),
    overriding: items.filter((item) => item.override !== null && item.ops.length > 0),
  }
}

export interface ApplyOutcome {
  readonly applied: readonly ItemPlan[]
  readonly failed: readonly { readonly plan: ItemPlan; readonly message: string }[]
}

async function runItem(plan: ItemPlan): Promise<void> {
  for (const op of plan.ops) {
    if (op.kind === "owner") await setResourceOwner(plan.resourceType, plan.id, op.username)
    else if (op.kind === "grant") await grantResourceViewer(plan.resourceType, plan.id, op.username)
    else await revokeResourceViewer(plan.resourceType, plan.id, op.username)
  }
}

/**
 * Runs the plan one item at a time over the per-item routes. There is no bulk
 * endpoint and no transaction, so an item that fails midway is reported and
 * the remaining items still run — the caller shows applied and failed counts.
 */
export async function applyPlans(plans: readonly ItemPlan[]): Promise<ApplyOutcome> {
  const applied: ItemPlan[] = []
  const failed: { plan: ItemPlan; message: string }[] = []
  for (const plan of plans) {
    if (plan.ops.length === 0) continue
    try {
      await runItem(plan)
      applied.push(plan)
    } catch (error) {
      failed.push({ plan, message: getErrorMessage(error, "Request failed") })
    }
  }
  return { applied, failed }
}
