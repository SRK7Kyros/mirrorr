/**
 * Entity merge store — the five precedence rules from the Data Layer
 * Contract §Entity merge rule, as pure list reductions so they are
 * arrival-order independent and testable without a QueryClient:
 *
 * 1. mutation response inserts only missing ids (cache wins if WS arrived first)
 * 2. authoritative snapshots (WS `data` / refetch) replace field-by-field,
 *    later-arriving wins
 * 3. no-data frames never write fields
 * 4. optimistic `pendingActions` live outside the cache, cleared on (2)
 * 5. `deleted` wins — removes the id and cancels its pending actions
 */

export type EntityId = number | string

export interface Identified {
  readonly id: EntityId
}

export function idKey(id: EntityId): string {
  return String(id)
}

/** Optimistic per-id actions — outside the entity cache (rule 4). */
const pendingActions = new Map<string, Set<string>>()

export function setPendingAction(id: EntityId, action: string): void {
  const key = idKey(id)
  const set = pendingActions.get(key) ?? new Set<string>()
  set.add(action)
  pendingActions.set(key, set)
}

export function getPendingActions(id: EntityId): readonly string[] {
  return [...(pendingActions.get(idKey(id)) ?? [])]
}

export function clearPendingActions(id: EntityId): void {
  pendingActions.delete(idKey(id))
}

export type EntityWrite<T> =
  | { readonly kind: "mutation"; readonly entity: T }
  | { readonly kind: "authoritative"; readonly entity: T }
  | { readonly kind: "no-data" }
  | { readonly kind: "deleted"; readonly id: EntityId }

/** Rule 1 — insert only if the id is absent; never overwrite, never touch pending. */
export function mutationInsert<T extends Identified>(list: T[], entity: T): T[] {
  return list.some((existing) => existing.id === entity.id) ? list : [entity, ...list]
}

/**
 * Rule 2 — field-by-field replace: snapshot fields win, fields absent from
 * the snapshot are retained; clears pendingActions for the id.
 */
export function applyAuthoritative<T extends Identified>(
  existing: T | undefined,
  snapshot: T,
): T {
  clearPendingActions(snapshot.id)
  return existing === undefined ? snapshot : { ...existing, ...snapshot }
}

/** Rule 2 as an upsert across a list — replaces in place, prepends when new. */
export function applyAuthoritativeToList<T extends Identified>(list: T[], snapshot: T): T[] {
  const index = list.findIndex((existing) => existing.id === snapshot.id)
  if (index === -1) {
    clearPendingActions(snapshot.id)
    return [snapshot, ...list]
  }
  const next = [...list]
  next[index] = applyAuthoritative(list[index], snapshot)
  return next
}

/** Rule 5 — deleted wins: drop the id and cancel its pending actions. */
export function removeFromList<T extends Identified>(list: T[], id: EntityId): T[] {
  clearPendingActions(id)
  const next = list.filter((existing) => existing.id !== id)
  return next.length === list.length ? list : next
}

/**
 * One write against one cached list. `no-data` returns the list untouched
 * (rule 3) — the caller performs the refetch instead.
 */
export function reduceEntityList<T extends Identified>(list: T[], write: EntityWrite<T>): T[] {
  switch (write.kind) {
    case "mutation":
      return mutationInsert(list, write.entity)
    case "authoritative":
      return applyAuthoritativeToList(list, write.entity)
    case "no-data":
      return list
    case "deleted":
      return removeFromList(list, write.id)
  }
}
