/**
 * The one cursor-pagination hook every list view builds on.
 *
 * Contract (`docs/web-frontend-spec.md` L138): `useInfiniteQuery` with
 * `limit=50`, `getNextPageParam` on `has_more`/`next_cursor`, `id`-descending
 * merge, "Load more" plus an IntersectionObserver auto-load. It never derives
 * a total — `loadedCount` is the number of rows actually held.
 */
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"
import {
  MAX_LOAD_ALL_PAGES,
  PAGE_LIMIT_DEFAULT,
  getNextPageParam,
  mergePagesByIdDesc,
  type IdRow,
} from "@/lib/pagination"
import type { CursorPage } from "@/lib/schemas/pagination"

/** The infinite query's page parameter: `null` is the first page's cursor. */
export type ListPageParam = number | null

/** One page request built by the caller for its endpoint. */
export interface InfinitePageRequest {
  readonly cursor: ListPageParam
  readonly limit: number
  readonly signal: AbortSignal
}

export interface UseInfiniteListOptions<T extends IdRow> {
  /** From `src/lib/query-keys.ts`; a filter change yields a fresh key. */
  readonly queryKey: readonly unknown[]
  readonly fetchPage: (request: InfinitePageRequest) => Promise<CursorPage<T>>
  readonly limit?: number
  readonly staleTime?: number
  readonly enabled?: boolean
}

export interface InfiniteListResult<T extends IdRow> {
  /** Merged, `id`-descending, deduplicated rows from every loaded page. */
  readonly rows: readonly T[]
  readonly loadedCount: number
  readonly hasMore: boolean
  readonly isInitialLoading: boolean
  readonly isLoadingMore: boolean
  readonly isLoadingAll: boolean
  readonly isError: boolean
  readonly error: Error | null
  readonly loadMore: () => void
  /** "Load all": repeated `next_cursor` fetches until `has_more:false`. */
  readonly loadAll: () => void
}

export function useInfiniteList<T extends IdRow>(
  options: UseInfiniteListOptions<T>,
): InfiniteListResult<T> {
  const { queryKey, fetchPage, limit = PAGE_LIMIT_DEFAULT, staleTime = 0, enabled = true } = options

  const query = useInfiniteQuery<
    CursorPage<T>,
    Error,
    InfiniteData<CursorPage<T>, ListPageParam>,
    readonly unknown[],
    ListPageParam
  >({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchPage({ cursor: pageParam, limit, signal }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => getNextPageParam(lastPage),
    staleTime,
    enabled,
  })

  const { data, error, fetchNextPage, hasNextPage, isError, isFetchingNextPage, isPending } = query
  const [isLoadingAll, setIsLoadingAll] = useState(false)

  const rows = useMemo(
    () => mergePagesByIdDesc<T>(data?.pages.map((page) => page.items) ?? []),
    [data],
  )

  const loadMore = useCallback(() => {
    void fetchNextPage().catch(() => undefined)
  }, [fetchNextPage])

  const loadAll = useCallback(() => {
    setIsLoadingAll(true)
    void (async () => {
      let result = await fetchNextPage()
      for (
        let fetchedPages = 1;
        result.hasNextPage && !result.isFetchNextPageError && fetchedPages < MAX_LOAD_ALL_PAGES;
        fetchedPages += 1
      ) {
        result = await fetchNextPage()
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingAll(false)
      })
  }, [fetchNextPage])

  return {
    rows,
    loadedCount: rows.length,
    hasMore: hasNextPage,
    isInitialLoading: isPending,
    isLoadingMore: isFetchingNextPage,
    isLoadingAll,
    isError,
    error,
    loadMore,
    loadAll,
  }
}
