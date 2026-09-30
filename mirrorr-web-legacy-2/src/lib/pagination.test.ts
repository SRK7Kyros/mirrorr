import { describe, expect, it, vi } from "vitest"
import {
  MAX_LOAD_ALL_PAGES,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_PLUGINS,
  fetchAllPages,
  getNextPageParam,
  mergePagesByIdDesc,
  type AllPagesRequest,
} from "@/lib/pagination"
import type { CursorPage } from "@/lib/schemas/pagination"

/**
 * Pagination contract (`docs/web-frontend-spec.md` L138, L132-L133;
 * `docs/general-client-specification.md` §1.4, §13.13):
 *
 * - `getNextPageParam = (last) => last.has_more ? last.next_cursor : undefined`
 * - every list is client-sorted by `id` descending after each page merge
 * - the plugin catalogs page with `limit=200` until `has_more:false`
 */

function page<T>(items: readonly T[], nextCursor: number | null, hasMore: boolean): CursorPage<T> {
  return { items, next_cursor: nextCursor, has_more: hasMore }
}

interface Row {
  readonly id: number
  readonly tag?: string
}

describe("getNextPageParam", () => {
  it("returns undefined at has_more:false even when a cursor is present", () => {
    expect(getNextPageParam(page<Row>([{ id: 42 }], 42, false))).toBeUndefined()
  })

  it("returns the cursor while has_more is true", () => {
    expect(getNextPageParam(page<Row>([{ id: 9 }], 9, true))).toBe(9)
  })

  it("returns undefined for a true has_more with a null cursor (malformed page)", () => {
    expect(getNextPageParam(page<Row>([{ id: 9 }], null, true))).toBeUndefined()
  })

  it("returns undefined when there is no page yet", () => {
    expect(getNextPageParam(undefined)).toBeUndefined()
  })
})

describe("mergePagesByIdDesc", () => {
  it("orders rows by id descending across out-of-order pages", () => {
    const merged = mergePagesByIdDesc<Row>([
      [{ id: 7 }, { id: 3 }, { id: 12 }, { id: 5 }, { id: 9 }],
      [{ id: 11 }, { id: 2 }, { id: 8 }, { id: 1 }, { id: 13 }],
    ])

    expect(merged.map((row) => row.id)).toEqual([13, 12, 11, 9, 8, 7, 5, 3, 2, 1])
  })

  it("keeps one row per id and prefers the newest occurrence", () => {
    const merged = mergePagesByIdDesc<Row>([
      [{ id: 2, tag: "old" }, { id: 1, tag: "kept" }],
      [{ id: 2, tag: "new" }],
    ])

    expect(merged).toEqual([{ id: 2, tag: "new" }, { id: 1, tag: "kept" }])
  })

  it("does not mutate the pages it is given", () => {
    const firstPage: readonly Row[] = [{ id: 1 }, { id: 2 }]

    mergePagesByIdDesc<Row>([firstPage])

    expect(firstPage.map((row) => row.id)).toEqual([1, 2])
  })
})

describe("fetchAllPages", () => {
  it("follows next_cursor until has_more:false with the plugin page size", async () => {
    const fetchPage = vi.fn(async (request: AllPagesRequest) => {
      if (request.cursor === null) return page<Row>([{ id: 3 }], 3, true)
      if (request.cursor === 3) return page<Row>([{ id: 2 }], 2, true)
      return page<Row>([{ id: 1 }], null, false)
    })

    await expect(fetchAllPages<Row>(fetchPage)).resolves.toEqual([{ id: 3 }, { id: 2 }, { id: 1 }])
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cursor: null, limit: PAGE_LIMIT_PLUGINS }),
    )
    expect(fetchPage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ cursor: 2, limit: PAGE_LIMIT_PLUGINS }),
    )
  })

  it("stops when a page claims has_more with a null cursor", async () => {
    const fetchPage = vi.fn(async () => page<Row>([{ id: 1 }], null, true))

    await expect(fetchAllPages<Row>(fetchPage)).resolves.toEqual([{ id: 1 }])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe("page size constants", () => {
  it("uses 50 for lists and 200 for the plugin catalogs", () => {
    expect(PAGE_LIMIT_DEFAULT).toBe(50)
    expect(PAGE_LIMIT_PLUGINS).toBe(200)
    expect(MAX_LOAD_ALL_PAGES).toBeGreaterThan(0)
  })
})
