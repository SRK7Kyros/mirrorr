import { revokeResourceUser, setResourceGrants, setResourceOwner } from "@/api/endpoints/access"
import { getErrorMessage } from "@/api/domain/errors"
import { CAPABILITIES, type AccessView, type Capability } from "@/api/schemas/privileged"

/** One item's access, in domain terms — a full grant record per capability. */
export interface ItemAccess {
  readonly owner: string | null
  readonly ownerMissing: boolean
  readonly grants: Readonly<Record<Capability, readonly string[]>>
}

/** What an edit asks for — an absent field is left exactly as it is. */
export interface AccessTarget {
  readonly owner?: string
  readonly grants?: Partial<Record<Capability, readonly string[]>>
}

export type AccessOp =
  | { readonly kind: "owner"; readonly username: string }
  | { readonly kind: "grant"; readonly capability: Capability; readonly username: string }
  | { readonly kind: "revoke"; readonly capability: Capability; readonly username: string }

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

/** A grant record with every capability present as an empty list. */
export function emptyGrants(): Record<Capability, string[]> {
  const grants = {} as Record<Capability, string[]>
  for (const capability of CAPABILITIES) grants[capability] = []
  return grants
}

/** Distinct usernames across every capability — the rendered "viewer" set. */
export function grantedUsernames(access: ItemAccess): string[] {
  const usernames = new Set<string>()
  for (const capability of CAPABILITIES) {
    for (const username of access.grants[capability]) usernames.add(username)
  }
  return [...usernames]
}

/** `AccessView` (wire) → the domain's full grant record. */
export function itemAccessFromView(view: AccessView): ItemAccess {
  const grants = emptyGrants()
  for (const grant of view.grants) {
    for (const capability of grant.capabilities) {
      grants[capability] = [...grants[capability], grant.username]
    }
  }
  return { owner: view.owner, ownerMissing: view.owner_missing, grants }
}

export function overrideOf(access: ItemAccess, users: readonly string[]): AccessOverride | null {
  const ownerless = access.owner === null || access.owner === ""
  if (!ownerless && (access.ownerMissing || !users.includes(access.owner as string))) {
    return { kind: "owner-missing" }
  }
  const count = grantedUsernames(access).length
  if (count > 0) return { kind: "grants", count }
  return null
}

/** The full set a user ends up with in `to` — the replace-set POST body. */
function capabilitiesFor(to: ItemAccess, username: string): Capability[] {
  return CAPABILITIES.filter((capability) => to.grants[capability].includes(username))
}

function mergeGrants(
  current: Readonly<Record<Capability, readonly string[]>>,
  target: Partial<Record<Capability, readonly string[]>> | undefined,
): Record<Capability, readonly string[]> {
  const merged = emptyGrants()
  for (const capability of CAPABILITIES) {
    merged[capability] = [...(target?.[capability] ?? current[capability])]
  }
  return merged
}

export function planItem(row: AccessRow, target: AccessTarget, users: readonly string[]): ItemPlan {
  const to: ItemAccess = {
    owner: target.owner ?? row.access.owner,
    ownerMissing: row.access.ownerMissing,
    grants: mergeGrants(row.access.grants, target.grants),
  }
  const ops: AccessOp[] = []
  if (to.owner !== null && to.owner !== row.access.owner) {
    ops.push({ kind: "owner", username: to.owner })
  }
  for (const capability of CAPABILITIES) {
    for (const username of to.grants[capability]) {
      if (!row.access.grants[capability].includes(username)) {
        ops.push({ kind: "grant", capability, username })
      }
    }
    for (const username of row.access.grants[capability]) {
      if (!to.grants[capability].includes(username)) {
        ops.push({ kind: "revoke", capability, username })
      }
    }
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

/**
 * One op → one request. A grant writes the user's whole resulting set through
 * the replace-set POST; a revoke that leaves the user with nothing clears them
 * through the DELETE route instead.
 */
async function runOp(plan: ItemPlan, op: AccessOp): Promise<void> {
  if (op.kind === "owner") {
    await setResourceOwner(plan.resourceType, plan.id, op.username)
    return
  }
  const capabilities = capabilitiesFor(plan.to, op.username)
  if (capabilities.length === 0) await revokeResourceUser(plan.resourceType, plan.id, op.username)
  else await setResourceGrants(plan.resourceType, plan.id, op.username, capabilities)
}

async function runItem(plan: ItemPlan): Promise<void> {
  for (const op of plan.ops) await runOp(plan, op)
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
