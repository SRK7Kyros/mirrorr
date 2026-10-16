import {
  addResourceOwnerGroup,
  removeResourceOwnerGroup,
  revokeGroupGrants,
  revokeResourceUser,
  setGroupGrants,
  setResourceGrants,
  setResourceOwner,
} from "@/api/endpoints/access"
import { getErrorMessage } from "@/api/domain/errors"
import { CAPABILITIES, type AccessView, type Capability } from "@/api/schemas/privileged"

/** One item's access, in domain terms — a full grant record per capability. */
export interface ItemAccess {
  readonly owner: string | null
  readonly ownerMissing: boolean
  readonly grants: Readonly<Record<Capability, readonly string[]>>
  /** Group ids granted per capability. Absent reads as "no group grants". */
  readonly groupGrants?: Readonly<Record<Capability, readonly number[]>>
  /** Group ids that own the item — additive to the single user owner. */
  readonly ownerGroups?: readonly number[]
}

/** What an edit asks for — an absent field is left exactly as it is. */
export interface AccessTarget {
  readonly owner?: string
  readonly grants?: Partial<Record<Capability, readonly string[]>>
  readonly groupGrants?: Partial<Record<Capability, readonly number[]>>
  readonly ownerGroups?: readonly number[]
}

export type AccessOp =
  | { readonly kind: "owner"; readonly username: string }
  | { readonly kind: "grant"; readonly capability: Capability; readonly username: string }
  | { readonly kind: "revoke"; readonly capability: Capability; readonly username: string }
  | { readonly kind: "group"; readonly groupId: number }
  | { readonly kind: "owner-group"; readonly groupId: number; readonly owner: boolean }

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

/** A group-grant record with every capability present as an empty list. */
export function emptyGroupGrants(): Record<Capability, number[]> {
  const grants = {} as Record<Capability, number[]>
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

/** Distinct group ids across every capability — the rendered group-grant set. */
export function grantedGroupIds(access: ItemAccess): number[] {
  const groupIds = new Set<number>()
  for (const capability of CAPABILITIES) {
    for (const groupId of access.groupGrants?.[capability] ?? []) groupIds.add(groupId)
  }
  return [...groupIds]
}

/**
 * `AccessView` (wire) → the domain's full grant record. The two group fields are
 * read defensively: the wire always carries them, but hand-written literals in
 * tests and old cached payloads predate them.
 */
export function itemAccessFromView(view: AccessView): ItemAccess {
  const grants = emptyGrants()
  for (const grant of view.grants) {
    for (const capability of grant.capabilities) {
      grants[capability] = [...grants[capability], grant.username]
    }
  }
  const groupGrants = emptyGroupGrants()
  for (const grant of view.group_grants ?? []) {
    for (const capability of grant.capabilities) {
      groupGrants[capability] = [...groupGrants[capability], grant.group_id]
    }
  }
  return {
    owner: view.owner,
    ownerMissing: view.owner_missing,
    grants,
    groupGrants,
    ownerGroups: (view.owner_groups ?? []).map((group) => group.id),
  }
}

export function overrideOf(access: ItemAccess, users: readonly string[]): AccessOverride | null {
  const ownerless = access.owner === null || access.owner === ""
  if (!ownerless && (access.ownerMissing || !users.includes(access.owner as string))) {
    return { kind: "owner-missing" }
  }
  const count = grantedUsernames(access).length + grantedGroupIds(access).length
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

function mergeGroupGrants(
  current: Readonly<Record<Capability, readonly number[]>> | undefined,
  target: Partial<Record<Capability, readonly number[]>> | undefined,
): Record<Capability, readonly number[]> {
  const merged = emptyGroupGrants()
  for (const capability of CAPABILITIES) {
    merged[capability] = [...(target?.[capability] ?? current?.[capability] ?? [])]
  }
  return merged
}

/** Group id → its capabilities, in the frozen capability order. */
function groupCapabilities(
  grants: Readonly<Record<Capability, readonly number[]>> | undefined,
): Map<number, Capability[]> {
  const byGroup = new Map<number, Capability[]>()
  for (const capability of CAPABILITIES) {
    for (const groupId of grants?.[capability] ?? []) {
      byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), capability])
    }
  }
  return byGroup
}

/** The full set a group ends up with in `to` — the replace-set POST body. */
function capabilitiesForGroup(to: ItemAccess, groupId: number): Capability[] {
  return CAPABILITIES.filter((capability) => (to.groupGrants?.[capability] ?? []).includes(groupId))
}

export function planItem(row: AccessRow, target: AccessTarget, users: readonly string[]): ItemPlan {
  const groupGrants = mergeGroupGrants(row.access.groupGrants, target.groupGrants)
  const ownerGroups = target.ownerGroups ?? row.access.ownerGroups ?? []
  const to: ItemAccess = {
    owner: target.owner ?? row.access.owner,
    ownerMissing: row.access.ownerMissing,
    grants: mergeGrants(row.access.grants, target.grants),
    groupGrants,
    ownerGroups,
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
  const currentGroups = groupCapabilities(row.access.groupGrants)
  const nextGroups = groupCapabilities(groupGrants)
  for (const groupId of new Set([...currentGroups.keys(), ...nextGroups.keys()])) {
    const before = currentGroups.get(groupId) ?? []
    const after = nextGroups.get(groupId) ?? []
    if (before.length !== after.length || before.some((capability) => !after.includes(capability))) {
      ops.push({ kind: "group", groupId })
    }
  }
  const fromOwners = row.access.ownerGroups ?? []
  for (const groupId of ownerGroups) {
    if (!fromOwners.includes(groupId)) ops.push({ kind: "owner-group", groupId, owner: true })
  }
  for (const groupId of fromOwners) {
    if (!ownerGroups.includes(groupId)) ops.push({ kind: "owner-group", groupId, owner: false })
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

/** What a bulk draft names: an empty capability, an unset owner and an empty
 *  owner-group list are each left exactly as the item has them. */
function namedTarget(target: AccessTarget): AccessTarget {
  const grants: Partial<Record<Capability, readonly string[]>> = {}
  const groupGrants: Partial<Record<Capability, readonly number[]>> = {}
  for (const capability of CAPABILITIES) {
    const usernames = target.grants?.[capability] ?? []
    if (usernames.length > 0) grants[capability] = usernames
    const groupIds = target.groupGrants?.[capability] ?? []
    if (groupIds.length > 0) groupGrants[capability] = groupIds
  }
  return {
    ...(target.owner === undefined || target.owner === "" ? {} : { owner: target.owner }),
    ...(Object.keys(grants).length === 0 ? {} : { grants }),
    ...(Object.keys(groupGrants).length === 0 ? {} : { groupGrants }),
    ...((target.ownerGroups ?? []).length > 0 ? { ownerGroups: target.ownerGroups } : {}),
  }
}

/**
 * The bulk target for one row: what the draft names, with its owner groups
 * ADDED to the row's own. A bulk apply can hand out ownership but never silently
 * revoke it — the override confirm cannot see an item whose only access is a
 * group owner, so replacement there would be invisible.
 */
export function bulkTargetFor(row: AccessRow, draft: AccessTarget): AccessTarget {
  const named = namedTarget(draft)
  const ownerGroups = named.ownerGroups ?? []
  if (ownerGroups.length === 0) return named
  return {
    ...named,
    ownerGroups: [...new Set([...(row.access.ownerGroups ?? []), ...ownerGroups])],
  }
}

/** `target` is one request for every row, or a per-row function when the answer
 *  depends on what that row already has (the bulk panel adds owner groups). */
export function planBulk(
  rows: readonly AccessRow[],
  target: AccessTarget | ((row: AccessRow) => AccessTarget),
  users: readonly string[],
): BulkPlan {
  const items = rows.map((row) =>
    planItem(row, typeof target === "function" ? target(row) : target, users),
  )
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
  if (op.kind === "owner-group") {
    if (op.owner) await addResourceOwnerGroup(plan.resourceType, plan.id, op.groupId)
    else await removeResourceOwnerGroup(plan.resourceType, plan.id, op.groupId)
    return
  }
  if (op.kind === "group") {
    const capabilities = capabilitiesForGroup(plan.to, op.groupId)
    if (capabilities.length === 0) await revokeGroupGrants(plan.resourceType, plan.id, op.groupId)
    else await setGroupGrants(plan.resourceType, plan.id, op.groupId, capabilities)
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
