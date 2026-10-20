import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { isApiClientPrincipal, subscribeAuth } from "@/api/auth"
import {
  getRealtimeState,
  notifyRealtimePollSuccess,
  subscribeRealtimeState,
} from "@/api/realtime/manager"
import { getNextPageParam, mergedSortedByIdDesc, type CursorPage } from "@/api/query-keys"
import { listRefetchInterval, type PollingContext } from "@/api/polling"

/**
 * Cursor-paginated entity list hook — the single list primitive every entity
 * surface (sessions, autoruns, recordings, profiles) is built on.
 *
 * Polling cadence is derived from the auth principal and the realtime socket
 * state (see `@/api/polling`): an API-client principal polls every 10s because
 * its resources emit no WS events, and a dead socket falls back to 15s.
 */

const MAX_LOAD_ALL_PAGES = 1_000

/* ── polling context (auth + realtime external stores) ─────────────── */
let pollSnapshot: PollingContext = {
  isApiClient: false,
  wsPollingFallback: false,
}
const pollListeners = new Set<() => void>()
let pollInstalled = false

function recomputePollSnapshot(): void {
  const next: PollingContext = {
    isApiClient: isApiClientPrincipal(),
    wsPollingFallback: getRealtimeState().pollingFallback,
  }
  if (
    next.isApiClient !== pollSnapshot.isApiClient ||
    next.wsPollingFallback !== pollSnapshot.wsPollingFallback
  ) {
    pollSnapshot = next
    for (const listener of pollListeners) listener()
  }
}

function subscribePollSnapshot(listener: () => void): () => void {
  pollListeners.add(listener)
  if (!pollInstalled) {
    pollInstalled = true
    subscribeAuth(recomputePollSnapshot)
    subscribeRealtimeState(recomputePollSnapshot)
    recomputePollSnapshot()
  }
  return () => {
    pollListeners.delete(listener)
  }
}

export function usePollingContext(): PollingContext {
  return useSyncExternalStore(subscribePollSnapshot, () => pollSnapshot)
}

/* ── infinite entity list ─────────────────────────────────────────── */
export interface EntityListResult<T> {
  readonly items: T[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly hasMore: boolean
  readonly isFetching: boolean
  readonly totalCount: number
  readonly loadMore: () => void
  readonly loadAll: () => Promise<T[]>
  readonly loadingAll: boolean
  readonly refetch: () => void
}

export function useEntityList<T extends { id: number }>(options: {
  queryKey: readonly unknown[]
  fetchPage: (cursor: number | undefined) => Promise<CursorPage<T>>
}): EntityListResult<T> {
  const { queryKey, fetchPage } = options
  const polling = usePollingContext()
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const [loadingAll, setLoadingAll] = useState(false)
  const lastPolledAt = useRef(0)

  const query = useInfiniteQuery<CursorPage<T>>({
    queryKey: queryKey as unknown as readonly unknown[],
    queryFn: ({ pageParam }) => fetchRef.current(pageParam as number | undefined),
    initialPageParam: undefined as number | undefined,
    getNextPageParam,
    refetchInterval: listRefetchInterval(polling),
  })

  // Views call notifyRealtimePollSuccess after a successful poll while the
  // offline banner is up — resumes the WS (Realtime Layer contract).
  useEffect(() => {
    const at = query.dataUpdatedAt
    if (at === 0 || at === lastPolledAt.current) return
    lastPolledAt.current = at
    if (polling.wsPollingFallback) notifyRealtimePollSuccess()
  }, [query.dataUpdatedAt, polling.wsPollingFallback])

  const { fetchNextPage } = query

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, query.hasNextPage, query.isFetchingNextPage])

  const loadAll = useCallback(async (): Promise<T[]> => {
    setLoadingAll(true)
    try {
      let pages: Array<CursorPage<T>> | undefined
      for (let fetched = 0; fetched < MAX_LOAD_ALL_PAGES; fetched += 1) {
        const result = await fetchNextPage()
        if (result.isFetchNextPageError) throw result.error
        pages = result.data?.pages
        const last = result.data?.pages.at(-1)
        if (last === undefined || !last.has_more || last.next_cursor == null) break
      }
      return mergedSortedByIdDesc(pages)
    } finally {
      setLoadingAll(false)
    }
  }, [fetchNextPage])

  const items = useMemo(() => mergedSortedByIdDesc(query.data?.pages), [query.data])

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasMore: query.hasNextPage === true,
    isFetching: query.isFetching,
    totalCount: items.length,
    loadMore,
    loadAll,
    loadingAll,
    refetch: () => void query.refetch(),
  }
}
