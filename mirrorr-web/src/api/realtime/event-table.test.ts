import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEventTable, subscribeSessionTelemetry, type EventTable } from "./event-table"

function seedClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(["sessions", {}], {
    pages: [
      {
        items: [{ id: 1, status: "active" }],
        next_cursor: null,
        has_more: false,
      },
    ],
    pageParams: [undefined],
  })
  client.setQueryData(["session", 1], { id: 1, status: "active" })
  return client
}

function isSessionDetailKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "session"
}

describe("event table", () => {
  let client: QueryClient
  let table: EventTable

  beforeEach(() => {
    vi.useFakeTimers()
    client = seedClient()
    table = createEventTable(client, {})
  })

  afterEach(() => {
    table.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("routes a session telemetry frame to its listeners without touching the cache", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionTelemetry(5, listener)
    const invalidate = vi.spyOn(client, "invalidateQueries")

    table.handleFrame({
      type: "event",
      event: "session.5.telemetry",
      processes: [{ name: "engine", cpu_percent: 12.5, rss_bytes: 2048 }],
      total_rss_bytes: 2048,
      ts: 1760000000,
    })
    vi.advanceTimersByTime(30)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      processes: [{ name: "engine", cpu_percent: 12.5, rss_bytes: 2048 }],
      total_rss_bytes: 2048,
      ts: 1760000000,
    })
    expect(invalidate).not.toHaveBeenCalled()

    unsubscribe()
  })

  it("coalesces duplicate (event-family, id) frames within 30ms, newest wins", () => {
    const spy = vi.spyOn(client, "setQueryData")

    table.handleFrame({
      type: "event",
      event: "session.updated",
      id: 1,
      data: { id: 1, status: "active", rev: 1 },
    })
    table.handleFrame({
      type: "event",
      event: "session.updated",
      id: 1,
      data: { id: 1, status: "completed", rev: 2 },
    })

    vi.advanceTimersByTime(29)
    expect(client.getQueryData(["session", 1])).toMatchObject({
      status: "active",
    })

    vi.advanceTimersByTime(1)
    const detailWrites = spy.mock.calls.filter((call) => isSessionDetailKey(call[0]))
    expect(detailWrites).toHaveLength(1)
    expect(client.getQueryData(["session", 1])).toMatchObject({
      status: "completed",
      rev: 2,
    })
    const pages = client.getQueryData<{ pages: { items: unknown[] }[] }>(["sessions", {}])
    expect(pages?.pages[0]?.items).toHaveLength(1)
  })

  it("never writes fields for no-data frames — refetch only (rule 3)", () => {
    const writeSpy = vi.spyOn(client, "setQueryData")
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    table.handleFrame({ type: "event", event: "session.updated", id: 1 })
    vi.advanceTimersByTime(30)

    expect(client.getQueryData(["session", 1])).toMatchObject({
      status: "active",
    })
    expect(writeSpy.mock.calls.filter((call) => isSessionDetailKey(call[0]))).toHaveLength(0)
    const invalidated = invalidateSpy.mock.calls.some((call) => {
      const filter = call[0]
      if (filter === null || typeof filter !== "object") return false
      const queryKey = (filter as { queryKey?: unknown }).queryKey
      return Array.isArray(queryKey) && queryKey[0] === "session"
    })
    expect(invalidated).toBe(true)
  })

  it("removes rows and detail on session.deleted (deleted wins)", () => {
    table.handleFrame({ type: "event", event: "session.deleted", id: 1 })
    vi.advanceTimersByTime(30)

    const pages = client.getQueryData<{ pages: { items: { id: number }[] }[] }>(["sessions", {}])
    expect(pages?.pages[0]?.items).toHaveLength(0)
    expect(client.getQueryData(["session", 1])).toBeUndefined()
  })

  it("keeps a deleted id deleted — a later session.updated cannot resurrect it", () => {
    table.handleFrame({ type: "event", event: "session.deleted", id: 1 })
    vi.advanceTimersByTime(30)

    table.handleFrame({
      type: "event",
      event: "session.updated",
      id: 1,
      data: { id: 1, status: "completed" },
    })
    vi.advanceTimersByTime(30)

    const pages = client.getQueryData<{ pages: { items: { id: number }[] }[] }>(["sessions", {}])
    expect(pages?.pages[0]?.items).toHaveLength(0)
    expect(client.getQueryData(["session", 1])).toBeUndefined()
  })

  it("patches detail and list rows on session.updated with data", () => {
    table.handleFrame({
      type: "event",
      event: "session.updated",
      id: 1,
      data: { id: 1, status: "completed" },
    })
    vi.advanceTimersByTime(30)

    expect(client.getQueryData(["session", 1])).toMatchObject({
      status: "completed",
    })
    const pages = client.getQueryData<{
      pages: { items: { status: string }[] }[]
    }>(["sessions", {}])
    expect(pages?.pages[0]?.items[0]?.status).toBe("completed")
  })

  it("inserts a created session into the first page", () => {
    table.handleFrame({
      type: "event",
      event: "session.created",
      id: 2,
      data: { id: 2, status: "active" },
    })
    vi.advanceTimersByTime(30)

    const pages = client.getQueryData<{ pages: { items: { id: number }[] }[] }>(["sessions", {}])
    expect(pages?.pages[0]?.items.map((item) => item.id)).toEqual([2, 1])
  })

  it("invalidates the recordings list on recording.created", () => {
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    table.handleFrame({
      type: "event",
      event: "recording.created",
      id: 4,
      data: { id: 4 },
    })
    vi.advanceTimersByTime(30)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["recordings"] })
  })

  it("invalidates profiles on any profile.* subject", () => {
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    table.handleFrame({
      type: "event",
      event: "profile.updated",
      id: 3,
      data: { id: 3 },
    })
    vi.advanceTimersByTime(30)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["profiles"] })
  })
})
