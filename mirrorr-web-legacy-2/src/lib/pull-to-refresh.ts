/**
 * Todo 25 (spec L506): the pull-to-refresh contract.
 *
 * The gesture belongs to the four entity lists only, arms at the spec's 64px,
 * and — critically — does not re-implement the refresh: `queryCache.onFocus()`
 * is the exact method TanStack's focus manager calls when the window regains
 * focus (`queryClient.mount()` subscribes it), so a pull refetches precisely
 * what a focus refetches — the active stale queries, which include the stale
 * name maps — and nothing else. No gesture issues a request of its own and no
 * gesture writes data.
 */
import type { QueryClient } from "@tanstack/react-query"

/** Spec L506: the pull distance that arms a refresh. */
export const PULL_TO_REFRESH_THRESHOLD_PX = 64

/** Spec L506: the four lists that carry the gesture (and only those). */
const PULL_TO_REFRESH_PATHS: ReadonlySet<string> = new Set([
  "/sessions",
  "/autoruns",
  "/recordings",
  "/profiles",
])

export function isPullToRefreshRoute(pathname: string): boolean {
  return PULL_TO_REFRESH_PATHS.has(pathname)
}

/** Downward pull distance; an upward drag is never a pull. */
export function pullDistance(startY: number, currentY: number): number {
  return Math.max(0, currentY - startY)
}

export function isRefreshArmed(distance: number): boolean {
  return distance >= PULL_TO_REFRESH_THRESHOLD_PX
}

/**
 * The refresh itself — the same call the focus manager makes, so the pull and
 * focus paths cannot drift apart.
 */
export function refetchForPullToRefresh(client: QueryClient): void {
  client.getQueryCache().onFocus()
}
