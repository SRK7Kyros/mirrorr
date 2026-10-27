import { useQuery } from "@tanstack/react-query"
import { fetchOverview } from "@/api/endpoints"
import type { Overview } from "@/api/schemas"
import { listRefetchInterval } from "@/api/polling"
import { queryKeys, staleTimes } from "@/api/query-keys"
import { usePollingContext } from "./use-entity-list"

/**
 * The strips' numbers. Polled on the same cadence as the lists they sit above,
 * so a count and the cards under it never disagree for longer than one tick —
 * a live session that ended shows up in both places at once.
 */
export function useOverview() {
  const polling = usePollingContext()
  return useQuery<Overview>({
    queryKey: queryKeys.overview,
    queryFn: fetchOverview,
    staleTime: staleTimes.overview,
    refetchInterval: listRefetchInterval(polling),
  })
}
