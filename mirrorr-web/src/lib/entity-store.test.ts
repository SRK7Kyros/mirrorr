import type { InfiniteData } from "@tanstack/react-query"
import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EntityStore, resourceFromEvent, type EntityResource } from "@/lib/entity-store"
import type { EntityValues } from "@/lib/entity-merge"
import { mergePagesByIdDesc } from "@/lib/pagination"
import { setOptimisticUpdateSource, shouldRefetchListOnFrame } from "@/lib/optimistic-guard"
import { queryKeys } from "@/lib/query-keys"
import type { CursorPage } from "@/lib/schemas/pagination"

/**
 * The store-level acceptance criteria for the coherence core:
 *
 * (a) create-response-then-WS AND WS-then-create-response each yield exactly
 *     one row (`docs/web-frontend-spec.md` L183-L189, §13.10.10);
 * (b) a data-less update triggers exactly one refetch and writes no fields
 *     (L165-L181);
 * (c) `deleted` cancels a pending action and always wins.
 */

interface Row extends EntityValues {
  readonly status?: string
  readonly progress?: number
  readonly record?: boolean
  readonly updated_at?: string
}

const SESSIONS = queryKeys.sessions()

function infiniteRows(items: readonly Row[], nextCursor: number | null = null): InfiniteData<CursorPage<Row>, number | null> {
  return {
    pages: [{ items, next_cursor: nextCursor, has_more: nextCursor !== null }],
    pageParams: [null],
  }
}

function rawRows(client: QueryClient, key: readonly unknown[] = SESSIONS): Row[] {
  const data = client.getQueryData<InfiniteData<CursorPage<Row>, number | null>>(key)
  if (data === undefined) return []
  return data.pages.flatMap((page) => [...page.items])
}

/** Reads the cache exactly like the views do (todo 7 id-desc merge). */
function mergedRows(client: QueryClient, key: readonly unknown[] = SESSIONS): Row[] {
  const data = client.getQueryData<InfiniteData<CursorPage<Row>, number | null>>(key)
  if (data === undefined) return []
  return mergePagesByIdDesc<Row>(data.pages.map((page) => page.items))
}

function makeStore(options: { refetchEntity?: (resource: EntityResource, id: number) => Promise<void> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const refetchEntity = options.refetchEntity ?? vi.fn(async () => undefined)
  const store = new EntityStore({ queryClient: client, refetchEntity })
  return { client, store, refetchEntity }
}

afterEach(() => {
  setOptimisticUpdateSource(null)
})

describe("resourceFromEvent", () => {
  it("maps the event family prefix and ignores unknown subjects", () => {
    expect(resourceFromEvent("session.updated")).toBe("session")
    expect(resourceFromEvent("notification.read")).toBe("notification")
    expect(resourceFromEvent("engine.updated")).toBeNull()
    expect(resourceFromEvent("")).toBeNull()
  })
})

describe("create response + WS echo", () => {
  it("create-response-then-WS yields exactly one row, with the echo fields", () => {
    const { client, store } = makeStore()
    client.setQueryData(SESSIONS, infiniteRows([{ id: 7, status: "completed" }]))

    store.applyMutationResponse("session", { id: 42, status: "active", record: false })
    store.applyFrame({
      event: "session.created",
      id: 42,
      data: { id: 42, status: "recording", record: false },
    })

    expect(rawRows(client).filter((row) => row.id === 42)).toHaveLength(1)
    expect(mergedRows(client).map((row) => row.id)).toEqual([42, 7])
    expect(mergedRows(client)[0]).toMatchObject({ id: 42, status: "recording" })
  })

  it("WS-then-create-response yields exactly one row and keeps the echo fields", () => {
    const { client, store } = makeStore()
    client.setQueryData(SESSIONS, infiniteRows([{ id: 7, status: "completed" }]))

    store.applyFrame({
      event: "session.created",
      id: 42,
      data: { id: 42, status: "recording", record: false },
    })
    store.applyMutationResponse("session", { id: 42, status: "active", record: false })

    expect(rawRows(client).filter((row) => row.id === 42)).toHaveLength(1)
    expect(mergedRows(client).map((row) => row.id)).toEqual([42, 7])
    expect(mergedRows(client)[0]).toMatchObject({ id: 42, status: "recording" })
  })

  it("does not inject an unknown id on an updated frame", () => {
    const { client, store } = makeStore()
    client.setQueryData(SESSIONS, infiniteRows([{ id: 7, status: "completed" }]))

    store.applyFrame({ event: "session.updated", id: 99, data: { id: 99, status: "active" } })

    expect(rawRows(client).map((row) => row.id)).toEqual([7])
  })

  it("patches the cached detail entity field-by-field", () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active", record: true })
    client.setQueryData(SESSIONS, infiniteRows([{ id: 5, status: "active", record: true }]))

    store.applyFrame({
      event: "session.updated",
      id: 5,
      data: { id: 5, status: "recording", record: true },
    })

    expect(client.getQueryData(queryKeys.session(5))).toEqual({
      id: 5,
      status: "recording",
      record: true,
    })
    expect(rawRows(client)[0]).toMatchObject({ id: 5, status: "recording" })
  })

  it("patches every cached occurrence of the id, not just the first page", () => {
    const { client, store } = makeStore()
    const twoPages: InfiniteData<CursorPage<Row>, number | null> = {
      pages: [
        { items: [{ id: 5, status: "active" }], next_cursor: 5, has_more: true },
        { items: [{ id: 5, status: "active" }, { id: 1 }], next_cursor: null, has_more: false },
      ],
      pageParams: [null, 5],
    }
    client.setQueryData(SESSIONS, twoPages)

    store.applyFrame({ event: "session.updated", id: 5, data: { id: 5, status: "recording" } })

    expect(rawRows(client).filter((row) => row.id === 5)).toEqual([
      { id: 5, status: "recording" },
      { id: 5, status: "recording" },
    ])
    expect(mergedRows(client)).toEqual([{ id: 5, status: "recording" }, { id: 1 }])
  })
})

describe("stale snapshots", () => {
  it("a stale partial snapshot after a newer one does not regress the entity", () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.session(5), { id: 5, status: "completed", progress: 100 })

    store.applyFrame({
      event: "session.updated",
      id: 5,
      data: { id: 5, status: "completed" },
    })

    expect(client.getQueryData(queryKeys.session(5))).toEqual({
      id: 5,
      status: "completed",
      progress: 100,
    })
  })

  it("does not reorder snapshots by their timestamp fields", () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.session(5), {
      id: 5,
      status: "recording",
      updated_at: "2026-09-19T12:00:00Z",
    })

    store.applyFrame({
      event: "session.updated",
      id: 5,
      data: { id: 5, status: "completed", updated_at: "2026-09-19T09:00:00Z" },
    })

    expect(client.getQueryData(queryKeys.session(5))).toMatchObject({ status: "completed" })
  })
})

describe("data-less frames", () => {
  it("triggers exactly one refetch and writes no fields", async () => {
    const { client, store, refetchEntity } = makeStore()
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active", progress: 3 })

    await store.applyFrame({ event: "session.updated", id: 5, data: null })

    expect(refetchEntity).toHaveBeenCalledTimes(1)
    expect(refetchEntity).toHaveBeenCalledWith("session", 5)
    expect(client.getQueryData(queryKeys.session(5))).toEqual({ id: 5, status: "active", progress: 3 })
  })

  it("coalesces concurrent data-less frames for the same id into one refetch", async () => {
    let release!: () => void
    const refetchEntity = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const { store } = makeStore({ refetchEntity })

    const first = store.applyFrame({ event: "session.started", id: 5, data: null })
    const second = store.applyFrame({ event: "session.updated", id: 5, data: null })

    expect(refetchEntity).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(refetchEntity).toHaveBeenCalledTimes(1)
  })

  it("refetches through the list family for a resource without a detail key", async () => {
    const { store, refetchEntity } = makeStore()

    await store.applyFrame({ event: "recording.updated", id: 9, data: null })

    expect(refetchEntity).toHaveBeenCalledWith("recording", 9)
  })
})

describe("deleted", () => {
  it("removes every cached copy, the detail entity and cancels pending state", () => {
    const { client, store } = makeStore()
    client.setQueryData(SESSIONS, infiniteRows([{ id: 5, status: "active" }, { id: 1 }]))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active" })

    const ticket = store.beginPending("session", 5, { kind: "stop" })
    expect(ticket.cancelled).toBe(false)

    store.applyFrame({ event: "session.deleted", id: 5 })

    expect(rawRows(client).map((row) => row.id)).toEqual([1])
    expect(client.getQueryData(queryKeys.session(5))).toBeUndefined()
    expect(ticket.cancelled).toBe(true)
    expect(store.getPending("session", 5)).toBeUndefined()
  })

  it("always wins: a later snapshot cannot resurrect a deleted row", () => {
    const { client, store } = makeStore()
    client.setQueryData(SESSIONS, infiniteRows([{ id: 5, status: "active" }]))

    store.applyDeleted("session", 5)
    store.applyFrame({ event: "session.updated", id: 5, data: { id: 5, status: "recording" } })
    store.applyMutationResponse("session", { id: 5, status: "active" })

    expect(rawRows(client)).toEqual([])
  })
})

describe("optimistic-update guard seam", () => {
  it("tells the guard a list with a pending action must not be refetched", () => {
    const { store } = makeStore()
    const uninstall = store.installOptimisticUpdateSource()
    store.beginPending("session", 5, { kind: "stop" })

    expect(shouldRefetchListOnFrame(JSON.stringify(queryKeys.sessions()), { data: null })).toBe(false)
    expect(shouldRefetchListOnFrame(JSON.stringify(queryKeys.autoruns()), { data: null })).toBe(true)

    uninstall()
    expect(shouldRefetchListOnFrame("sessions", { data: null })).toBe(true)
  })
})
