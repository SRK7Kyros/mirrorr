import { describe, expect, it } from "vitest"
import {
  mergeEntitySnapshot,
  removeEntityFromPages,
  upsertEntityInPages,
  type EntityPage,
  type EntityValues,
} from "@/lib/entity-merge"

/**
 * The exact precedence from `docs/web-frontend-spec.md` L165-L189 and
 * `docs/general-client-specification.md` §13.10.10, at the pure-function
 * level:
 *
 * - a later authoritative snapshot wins FIELD-BY-FIELD (carried fields only);
 * - a partial (stale) snapshot cannot regress fields it does not carry;
 * - freshness never comes from timestamps — `updated_at` is inert data;
 * - a mutation response inserts only unknown ids;
 * - `deleted` removes every occurrence.
 */

interface Row extends EntityValues {
  readonly status?: string
  readonly progress?: number
  readonly record?: boolean
  readonly updated_at?: string
}

describe("mergeEntitySnapshot", () => {
  it("keeps fields a later partial snapshot does not carry (no regression by omission)", () => {
    const newer: Row = { id: 1, status: "completed", progress: 100 }
    const stale: Row = { id: 1, status: "completed" }

    expect(mergeEntitySnapshot(newer, stale)).toEqual({
      id: 1,
      status: "completed",
      progress: 100,
    })
  })

  it("lets the later snapshot win field-by-field for the fields it carries", () => {
    const cached: Row = { id: 1, status: "active", record: true }
    const snapshot: Row = { id: 1, status: "recording" }

    expect(mergeEntitySnapshot(cached, snapshot)).toEqual({
      id: 1,
      status: "recording",
      record: true,
    })
  })

  it("never derives freshness from timestamps", () => {
    const cached: Row = { id: 1, status: "recording", updated_at: "2026-09-19T12:00:00Z" }
    const laterArrival: Row = { id: 1, status: "completed", updated_at: "2026-09-19T09:00:00Z" }

    // The server's timestamp field looks older; arrival order still decides.
    expect(mergeEntitySnapshot(cached, laterArrival)).toEqual({
      id: 1,
      status: "completed",
      updated_at: "2026-09-19T09:00:00Z",
    })
  })

  it("treats an explicit null as a value but undefined as not sent", () => {
    const cached: Row = { id: 1, status: "active", progress: 10 }
    const snapshot: Row = { id: 1, progress: null as unknown as number }

    expect(mergeEntitySnapshot(cached, snapshot)).toEqual({ id: 1, status: "active", progress: null })
  })

  it("returns the snapshot when nothing is cached and never mutates the input", () => {
    const cached: Row = Object.freeze({ id: 1, status: "active", progress: 10 })
    const snapshot: Row = { id: 1, status: "recording" }

    expect(mergeEntitySnapshot(undefined, snapshot)).toBe(snapshot)
    expect(mergeEntitySnapshot(cached, snapshot)).not.toBe(cached)
    expect(cached).toEqual({ id: 1, status: "active", progress: 10 })
  })
})

describe("upsertEntityInPages", () => {
  function page(items: readonly Row[]): EntityPage<Row> {
    return items
  }

  it("prepends an unknown id to the first page when insertion is allowed", () => {
    const pages = [page([{ id: 7 }, { id: 5 }]), page([{ id: 3 }])]

    const next = upsertEntityInPages(pages, { id: 9, status: "active" }, { insert: true })

    expect(next[0]).toEqual([{ id: 9, status: "active" }, { id: 7 }, { id: 5 }])
    expect(next[1]).toEqual([{ id: 3 }])
  })

  it("never injects an unknown id when insertion is not allowed (updated frames)", () => {
    const pages = [page([{ id: 7 }])]

    const next = upsertEntityInPages(pages, { id: 9, status: "active" }, { insert: false })

    expect(next).toBe(pages)
  })

  it("insertOnly leaves a known id byte-for-byte untouched (mutation response)", () => {
    const pages = [page([{ id: 7, status: "recording" }])]

    const next = upsertEntityInPages(
      pages,
      { id: 7, status: "active", record: false },
      { insert: true, insertOnly: true },
    )

    expect(next).toBe(pages)
    expect(next[0]).toEqual([{ id: 7, status: "recording" }])
  })

  it("merges every cached occurrence of a known id so no stale duplicate survives", () => {
    const pages = [page([{ id: 5, status: "active" }]), page([{ id: 5, status: "active" }, { id: 1 }])]

    const next = upsertEntityInPages(pages, { id: 5, status: "recording" }, { insert: false })

    expect(next[0]).toEqual([{ id: 5, status: "recording" }])
    expect(next[1]).toEqual([{ id: 5, status: "recording" }, { id: 1 }])
  })

  it("does not mutate the input pages", () => {
    const first: readonly Row[] = [{ id: 1 }]

    upsertEntityInPages([first], { id: 2 }, { insert: true })

    expect(first).toEqual([{ id: 1 }])
  })
})

describe("removeEntityFromPages", () => {
  it("removes every occurrence and keeps the other rows", () => {
    const pages = [[{ id: 5 }, { id: 7 }], [{ id: 5 }]] as const

    expect(removeEntityFromPages<Row>([pages[0], pages[1]], 5)).toEqual([[{ id: 7 }], []])
  })

  it("returns the same pages reference when the id is absent", () => {
    const pages: readonly (readonly Row[])[] = [[{ id: 1 }]]

    expect(removeEntityFromPages(pages, 99)).toBe(pages)
  })
})
