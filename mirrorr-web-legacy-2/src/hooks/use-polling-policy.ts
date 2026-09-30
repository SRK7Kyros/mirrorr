/**
 * Todo 21: binds the pure interval selection (`selectPollingPolicy`) to the
 * live principal and realtime-status stores. Views call this with their
 * surface and spread the result into query options.
 */
import { useSyncExternalStore } from "react"
import { getAuthState, isApiClientPrincipal, subscribeToAuth } from "@/lib/auth-store"
import { selectPollingPolicy, type PollingPolicy, type PollingSurface } from "@/lib/polling-policy"
import { getRealtimeStatus, subscribeToRealtimeStatus } from "@/lib/realtime-status"

export function usePollingPolicy(surface: PollingSurface): PollingPolicy {
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)
  const realtime = useSyncExternalStore(subscribeToRealtimeStatus, getRealtimeStatus, getRealtimeStatus)

  return selectPollingPolicy(isApiClientPrincipal(auth) ? "api-client" : "user", realtime, surface)
}
