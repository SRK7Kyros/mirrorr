/**
 * V6 linked-session discovery (spec L279-L301, §13.3): scan the loaded sessions
 * cache for an `autorun_id` match. The query shares the default sessions list
 * key AND its `InfiniteData` page shape, so a `session.created` frame applied
 * by the entity store lands in the same cache and re-renders the card without
 * a special channel.
 */
import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { PAGE_LIMIT_DEFAULT, getNextPageParam } from "@/lib/pagination"
import { queryKeys } from "@/lib/query-keys"
import type { Autorun } from "@/lib/schemas/autoruns"
import type { Session } from "@/lib/schemas/sessions"
import { fetchSessionsPage } from "@/lib/sessions-api"

/** The newest loaded session whose `autorun_id` matches (client-side filter). */
export function findLinkedSession(
  sessions: readonly Session[],
  autorunId: number | undefined,
): Session | undefined {
  if (autorunId === undefined) return undefined
  let latest: Session | undefined
  for (const session of sessions) {
    if (session.autorun_id !== autorunId) continue
    if (latest === undefined || session.id > latest.id) latest = session
  }
  return latest
}

export function useLinkedSession(autorun: Autorun | undefined): Session | undefined {
  const query = useInfiniteQuery({
    queryKey: queryKeys.sessions(),
    queryFn: ({ pageParam, signal }) =>
      fetchSessionsPage({ cursor: pageParam, limit: PAGE_LIMIT_DEFAULT, signal }),
    initialPageParam: null,
    getNextPageParam,
    enabled: autorun !== undefined,
    refetchInterval: 30_000,
  })

  const sessions = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  )

  return useMemo(() => findLinkedSession(sessions, autorun?.id), [sessions, autorun?.id])
}
