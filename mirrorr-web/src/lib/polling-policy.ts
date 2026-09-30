/**
 * Polling policy — refetch intervals that override the QueryClient defaults
 * set once in `query-client.ts` (contract §Polling backstop: a green socket
 * does not guarantee list completeness — API-key resources emit no events).
 */
export type PollingIntervalMs = number

/** All-principal list backstop. */
export const LIST_BACKSTOP_MS = 30_000
/** API-client principal: stricter cadence regardless of socket state. */
export const API_CLIENT_POLL_MS = 10_000
/** WS dead → 12-failure banner cadence. */
export const WS_FALLBACK_POLL_MS = 15_000

export interface PollingContext {
  readonly isApiClient: boolean
  readonly wsPollingFallback: boolean
}

/** List queries: api-client 10s beats WS-fallback 15s beats backstop 30s. */
export function listRefetchInterval(context: PollingContext): PollingIntervalMs {
  if (context.isApiClient) return API_CLIENT_POLL_MS
  if (context.wsPollingFallback) return WS_FALLBACK_POLL_MS
  return LIST_BACKSTOP_MS
}

/** Open detail queries — no steady interval normally; degraded modes poll. */
export function detailRefetchInterval(context: PollingContext): PollingIntervalMs | false {
  if (context.isApiClient) return API_CLIENT_POLL_MS
  if (context.wsPollingFallback) return WS_FALLBACK_POLL_MS
  return false
}
