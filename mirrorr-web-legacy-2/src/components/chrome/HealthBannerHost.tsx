/**
 * Spec L407: the health banner appears when `GET /health` fails, with the
 * exact copy "API unreachable — retrying". The probe retries once, then keeps
 * re-checking every 30s so the banner clears on its own.
 *
 * Spec L171: after the realtime manager exhausts its 12 attempts the dot is
 * red and the "Live updates offline — polling every 15s" banner shows, with a
 * manual Retry that resumes both sockets. Todo 21 owns the 15s polling cadence
 * behind that copy; todo 18 owns the banner state and the retry seam.
 *
 * Spec L158: an API-client principal never sees this socket banner — its own
 * persistent `ApiClientBanner` is the only offline notice (exactly one banner).
 */
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { HealthBanner } from "@/components/ui/HealthBanner"
import { getAuthState, isApiClientPrincipal, subscribeToAuth } from "@/lib/auth-store"
import { fetchHealth } from "@/lib/health-api"
import { queryKeys } from "@/lib/query-keys"
import { retryRealtimeNow } from "@/lib/realtime-manager"
import { getRealtimeStatus, subscribeToRealtimeStatus } from "@/lib/realtime-status"

export const HEALTH_PROBE_INTERVAL_MS = 30_000

export function HealthBannerHost() {
  const realtimeStatus = useSyncExternalStore(subscribeToRealtimeStatus, getRealtimeStatus)
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)
  const query = useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 0,
    retry: false,
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })

  if (query.isError) {
    return <HealthBanner variant="api" onRetry={() => void query.refetch()} />
  }

  if (realtimeStatus === "offline" && !isApiClientPrincipal(auth)) {
    return <HealthBanner variant="socket" onRetry={retryRealtimeNow} />
  }

  return null
}
