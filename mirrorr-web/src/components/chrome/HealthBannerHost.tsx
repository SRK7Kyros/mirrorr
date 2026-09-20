/**
 * Spec L407: the health banner appears when `GET /health` fails, with the
 * exact copy "API unreachable — retrying". The probe retries once, then keeps
 * re-checking every 30s so the banner clears on its own.
 */
import { useQuery } from "@tanstack/react-query"
import { HealthBanner } from "@/components/ui/HealthBanner"
import { fetchHealth } from "@/lib/health-api"
import { queryKeys } from "@/lib/query-keys"

export const HEALTH_PROBE_INTERVAL_MS = 30_000

export function HealthBannerHost() {
  const query = useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 0,
    retry: false,
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })

  if (!query.isError) return null

  return <HealthBanner variant="api" onRetry={() => void query.refetch()} />
}
