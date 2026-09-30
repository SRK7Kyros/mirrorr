/**
 * Todo 21 (spec L140, L154-L158, L171): the single place that turns principal
 * type × realtime status × surface into a TanStack polling contract. Views
 * call `usePollingPolicy(surface)` and spread the result — they never pick a
 * millisecond number themselves.
 */
import { QUERY_POLL_INTERVALS_MS } from "@/lib/query-keys"
import type { RealtimeStatus } from "@/lib/realtime-status"

export type PollingPrincipal = "user" | "api-client"

/**
 * Which query surface is asking: an entity list, an open entity detail, or an
 * admin table (Users / API clients). Admin tables have no backstop interval —
 * the spec only requires focus refetch there.
 */
export type PollingSurface = "list" | "detail" | "admin"

export interface PollingPolicy {
  /** Ready for `useQuery`/`useInfiniteQuery`; `false` disables the backstop. */
  readonly refetchInterval: number | false
  /** Every spec rule refetches on window focus. */
  readonly refetchOnWindowFocus: boolean
}

export function selectPollingPolicy(
  principal: PollingPrincipal,
  realtime: RealtimeStatus,
  surface: PollingSurface,
): PollingPolicy {
  if (principal === "api-client") {
    // Spec L154: API-client mode forces polling regardless of socket state —
    // 10s already beats the 15s fallback, so offline never downgrades it.
    return {
      refetchInterval: QUERY_POLL_INTERVALS_MS.apiClient,
      refetchOnWindowFocus: true,
    }
  }

  if (realtime === "offline") {
    // Spec L171: after the reconnect ceiling the visible list + open detail
    // poll at 15s until a poll (or the banner's Retry) resumes the socket.
    return {
      refetchInterval: QUERY_POLL_INTERVALS_MS.offlineFallback,
      refetchOnWindowFocus: true,
    }
  }

  return {
    refetchInterval: surface === "admin" ? false : QUERY_POLL_INTERVALS_MS.entityBackstop,
    refetchOnWindowFocus: true,
  }
}
