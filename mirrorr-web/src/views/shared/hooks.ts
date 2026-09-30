import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query"
import { isApiClientPrincipal, subscribeAuth } from "@/lib/auth"
import { notifyRealtimePollSuccess, getRealtimeState, subscribeRealtimeState } from "@/lib/realtime-manager"
import {
  fetchAllLookupPages,
  getNextPageParam,
  mergedSortedByIdDesc,
  queryKeys,
  staleTimes,
  type CursorPage,
} from "@/lib/query-keys"
import { listRefetchInterval, type PollingContext } from "@/lib/polling-policy"
import { COUNTDOWN_TICK_MS, formatDuration, parseNaiveUtc } from "@/lib/time"
import type { Engine, Profile, Resolver } from "@/lib/schemas"
import { fetchAllEngines, fetchAllResolvers, fetchProfilePage } from "./api"

/* ── polling context (auth + realtime external stores) ─────────────── */
let pollSnapshot: PollingContext = { isApiClient: false, wsPollingFallback: false }
const pollListeners = new Set<() => void>()
let pollInstalled = false

function recomputePollSnapshot(): void {
  const next: PollingContext = {
    isApiClient: isApiClientPrincipal(),
    wsPollingFallback: getRealtimeState().pollingFallback,
  }
  if (next.isApiClient !== pollSnapshot.isApiClient || next.wsPollingFallback !== pollSnapshot.wsPollingFallback) {
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

/* ── lookups + name memo-maps ─────────────────────────────────────── */
export function useEngines(): Engine[] {
  const query = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? []
}

export function useResolvers(): Resolver[] {
  const query = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? []
}

export function useProfiles(): Profile[] {
  return useProfilesLookup()
}

function useProfilesLookup(): Profile[] {
  const query = useQuery({
    queryKey: queryKeys.profiles({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchProfilePage(cursor)),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? []
}

export interface NameMaps {
  readonly engines: Map<number, string>
  readonly resolvers: Map<number, string>
  readonly profiles: Map<number, string>
}

export function useNameMaps(): NameMaps {
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfilesLookup()
  return useMemo(() => {
    const map = (items: ReadonlyArray<{ id: number; name: string }>) => {
      const next = new Map<number, string>()
      for (const item of items) next.set(item.id, item.name)
      return next
    }
    return { engines: map(engines), resolvers: map(resolvers), profiles: map(profiles) }
  }, [engines, resolvers, profiles])
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
  readonly loadAll: () => Promise<void>
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

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [query])

  const loadAll = useCallback(async () => {
    setLoadingAll(true)
    try {
      for (;;) {
        const result = await query.fetchNextPage()
        const last = result.data?.pages.at(-1)
        if (last === undefined || !last.has_more) break
      }
    } finally {
      setLoadingAll(false)
    }
  }, [query])

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

/* ── ticks + formatting ───────────────────────────────────────────── */
export function useNowTick(intervalMs: number = COUNTDOWN_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Live session duration in seconds (1s tick while running). */
export function useLiveDurationSeconds(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  const running = (startedAt ?? "") !== "" && (endedAt ?? "") === ""
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    const compute = () => {
      if ((startedAt ?? "") === "") {
        setSeconds(null)
        return
      }
      const start = parseNaiveUtc(startedAt as string).getTime()
      const end = (endedAt ?? "") === "" ? Date.now() : parseNaiveUtc(endedAt as string).getTime()
      setSeconds(Math.max(0, Math.floor((end - start) / 1000)))
    }
    compute()
    if (!running) return
    const timer = setInterval(compute, 1000)
    return () => clearInterval(timer)
  }, [startedAt, endedAt, running])

  return seconds
}

export function useFormattedDuration(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): string {
  const seconds = useLiveDurationSeconds(startedAt, endedAt)
  return seconds === null ? "—" : formatDuration(seconds)
}

export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(max-width: 639px)").matches
  })
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 639px)")
    const onChange = () => setCompact(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])
  return compact
}

/** `?highlight=<id>` → scroll the matching row/card into view + 2s accent ring. */
export function useHighlightRef(highlightId: number | null | undefined) {
  const done = useRef(false)
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null || highlightId == null || done.current) return
      const elId = element.dataset.id ?? element.dataset.rowId
      if (elId !== String(highlightId)) return
      done.current = true
      element.dataset.highlight = "true"
      element.scrollIntoView({ block: "center" })
      window.setTimeout(() => {
        delete element.dataset.highlight
      }, 2000)
    },
    [highlightId],
  )
}

/* ── infinite-cache helpers (delete/remove across pages) ──────────── */
export function removeFromInfiniteLists(
  client: QueryClient,
  root: readonly unknown[],
  id: number | string,
): void {
  client.setQueriesData<{ pages: Array<CursorPage<{ id: number | string }>>; pageParams: unknown[] }>(
    { queryKey: root },
    (previous) => {
      if (previous === undefined) return undefined
      return {
        ...previous,
        pages: previous.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== id),
        })),
      }
    },
  )
}
