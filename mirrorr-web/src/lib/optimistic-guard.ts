/**
 * The optimistic-update refetch guard — the client-side seam for the
 * request-savings rule.
 *
 * Contract: `docs/general-client-specification.md` §13.13 — "Never refetch the
 * list you just got an optimistic update for; rely on WS coalesced patch;
 * refetch only on `data==null` frames."
 *
 * The realtime manager (todo 18) and the merge/optimistic store (todo 10) own
 * the actual socket and pending-mutation bookkeeping. This module owns only
 * the pure decision plus the injection seam: `setOptimisticUpdateSource()` is
 * where todo 10 registers "is an optimistic update pending for this list?".
 * Until then the source defaults to "nothing pending".
 */

/** Answers whether the list identified by `listKey` has an in-flight optimistic update. */
export type PendingOptimisticSource = (listKey: string) => boolean

/** A WS patch frame in the shape the relay emits: `data` is the entity or null. */
export interface PatchFrame {
  readonly data: unknown
}

const NO_PENDING_UPDATES: PendingOptimisticSource = () => false

let pendingOptimisticSource: PendingOptimisticSource = NO_PENDING_UPDATES

/** Registers (or clears, with `null`) the pending-optimistic source. */
export function setOptimisticUpdateSource(source: PendingOptimisticSource | null): void {
  pendingOptimisticSource = source ?? NO_PENDING_UPDATES
}

/**
 * The decision the realtime layer asks before invalidating a list after a WS
 * frame:
 *
 * - a frame that carries data is applied as a coalesced patch — no refetch;
 * - a `data==null` frame (delete/skip) may refetch, unless an optimistic
 *   update is pending for that list.
 */
export function shouldRefetchListOnFrame(listKey: string, frame: PatchFrame): boolean {
  if (frame.data !== null) return false
  return !pendingOptimisticSource(listKey)
}
