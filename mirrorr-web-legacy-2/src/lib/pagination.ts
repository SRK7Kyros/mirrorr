/**
 * Cursor-pagination helpers shared by every list.
 *
 * Contract: `docs/web-frontend-spec.md` L138 ("useInfiniteQuery with
 * `limit=50`, `getNextPageParam = (last) => last.has_more ? last.next_cursor :
 * undefined` ... every list is client-sorted by `id` descending after each
 * page merge") and L132-L133 (engines/resolvers are fetched all-pages with
 * `limit=200`, following `next_cursor` while `has_more`).
 *
 * Nothing here computes a total: the server gives none, so callers render
 * "Showing N" from the rows they actually hold (never a fabricated count).
 */
import type { CursorPage } from "@/lib/schemas/pagination"

/** Every normal list pages with `limit=50` (spec L138). */
export const PAGE_LIMIT_DEFAULT = 50

/** The engine/resolver catalogs page with `limit=200` (spec L132-L133). */
export const PAGE_LIMIT_PLUGINS = 200

/** Safety cap for "Load all"/all-pages loops against a misbehaving server. */
export const MAX_LOAD_ALL_PAGES = 100

/** Anything the client sorts by id. */
export interface IdRow {
  readonly id: number
}

/** One page request: `cursor` is the previous page's `next_cursor`. */
export interface AllPagesRequest {
  readonly cursor: number | null
  readonly limit: number
  readonly signal?: AbortSignal
}

export interface FetchAllPagesOptions {
  readonly limit?: number
  readonly signal?: AbortSignal
}

/**
 * TanStack's `getNextPageParam` (spec L138): `undefined` stops pagination —
 * which happens exactly when the page reports `has_more:false` (a `null`
 * cursor with `has_more:true` is a malformed page and also stops).
 */
export function getNextPageParam(page: CursorPage<unknown> | undefined): number | undefined {
  if (page === undefined || !page.has_more) return undefined
  return page.next_cursor ?? undefined
}

/**
 * Flattens pages into one list sorted by `id` DESCENDING, as every list view
 * must (spec L138). Duplicate ids — an optimistic patch and a later page can
 * both carry one — collapse to the NEWEST occurrence (the later page wins).
 * The input pages are never mutated.
 */
export function mergePagesByIdDesc<T extends IdRow>(pages: readonly (readonly T[])[]): T[] {
  const byId = new Map<number, T>()
  for (const page of pages) {
    for (const row of page) byId.set(row.id, row)
  }
  return [...byId.values()].toSorted((left, right) => right.id - left.id)
}

/**
 * Fetches every page of a cursor list by following `next_cursor` until
 * `has_more:false` (used by the name map and the "Load all" action). Defaults
 * to the plugin page size; the safety cap only guards a broken server.
 */
export async function fetchAllPages<T>(
  fetchPage: (request: AllPagesRequest) => Promise<CursorPage<T>>,
  options: FetchAllPagesOptions = {},
): Promise<readonly T[]> {
  const limit = options.limit ?? PAGE_LIMIT_PLUGINS
  const rows: T[] = []
  let cursor: number | null = null

  for (let fetchedPages = 0; fetchedPages < MAX_LOAD_ALL_PAGES; fetchedPages += 1) {
    const result = await fetchPage({ cursor, limit, signal: options.signal })
    rows.push(...result.items)
    if (!result.has_more || result.next_cursor === null) break
    cursor = result.next_cursor
  }

  return rows
}
