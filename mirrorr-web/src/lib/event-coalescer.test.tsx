/**
 * Todo 19 step 2 — the 30ms coalescing buffer and the frame-bus installation.
 *
 * Contract: `docs/web-frontend-spec.md` L169 ("coalesce on a 30ms microtask
 * timer, dedupe by `(event-family, id)` keeping the newest frame") and
 * `docs/general-client-specification.md` §11.1 rule 4 ("batch/coalesce bursts
 * (30ms microtask flush) to avoid re-render storms").
 */
import { QueryClient } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import { useSyncExternalStore } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EntityStore, type EntityResource } from "@/lib/entity-store"
import {
  EVENT_COALESCE_MS,
  EventTable,
  installEventTable,
  type ParsedEventFrame,
} from "@/lib/event-table"
import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { clearToasts } from "@/lib/toast"
import type { RealtimeFrame } from "@/lib/realtime-manager"

interface Row {
  readonly id: number
  readonly status?: string
  readonly [field: string]: unknown
}

interface SeedData {
  readonly pages: readonly { readonly items: readonly Row[] }[]
}

function seededSessions(client: QueryClient, ...items: readonly Row[]): void {
  client.setQueryData(queryKeys.sessions(), {
    pages: [{ items, next_cursor: null, has_more: false }],
    pageParams: [null],
  })
}

function itemsOf(client: QueryClient): readonly Row[] {
  const data = client.getQueryData<SeedData>(queryKeys.sessions())
  return data?.pages.flatMap((page) => page.items) ?? []
}

interface Harness {
  readonly client: QueryClient
  readonly store: EntityStore
  readonly table: EventTable
  readonly dispatched: ReturnType<typeof vi.fn>
  readonly unsubscribe: () => void
}

function makeHarness(overrides: { readonly coalesceMs?: number } = {}): Harness {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const store = new EntityStore({
    queryClient: client,
    refetchEntity: vi.fn(async (_resource: EntityResource, _id: number) => undefined),
  })
  const table = new EventTable({
    store,
    queryClient: client,
    navigate: vi.fn(),
    isDetailOpen: () => false,
    invalidateNamesForEvent: vi.fn(),
    readPrefs: () => DEFAULT_NOTIFICATION_PREFS,
    coalesceMs: overrides.coalesceMs,
  })
  const dispatched = vi.spyOn(table, "dispatch")
  const unsubscribe = vi.fn<() => void>()
  return { client, store, table, dispatched, unsubscribe }
}

function updateFrame(id: number, status: string): Record<string, unknown> {
  return { event: "session.updated", id, data: { id, status } }
}

beforeEach(() => {
  window.localStorage.clear()
  clearToasts()
  vi.useFakeTimers()
})

afterEach(() => {
  clearToasts()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("30ms coalescing buffer", () => {
  it("exposes the spec's 30ms window", () => {
    expect(EVENT_COALESCE_MS).toBe(30)
  })

  it("dedupes a burst of five updates for one id and applies only the newest", () => {
    const { client, table, dispatched } = makeHarness()
    seededSessions(client, { id: 5, status: "s1" })

    for (const status of ["s1", "s2", "s3", "s4", "s5"]) {
      table.handlePayload(updateFrame(5, status))
    }

    expect(dispatched).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })

    expect(dispatched).toHaveBeenCalledTimes(1)
    const applied = dispatched.mock.calls[0]?.[0] as ParsedEventFrame | undefined
    expect(applied?.data).toEqual({ id: 5, status: "s5" })
    expect(itemsOf(client)).toEqual([{ id: 5, status: "s5" }])
  })

  it("keeps different ids in the same window and flushes them separately", () => {
    const { client, table, dispatched } = makeHarness()
    seededSessions(client, { id: 1, status: "active" }, { id: 2, status: "active" })

    table.handlePayload(updateFrame(1, "recording"))
    table.handlePayload(updateFrame(2, "completed"))
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })

    expect(dispatched).toHaveBeenCalledTimes(2)
    expect(itemsOf(client)).toEqual([
      { id: 1, status: "recording" },
      { id: 2, status: "completed" },
    ])
  })

  it("collapses created → updated for one id into the newest frame (newest wins)", () => {
    const { client, table, dispatched } = makeHarness()
    seededSessions(client)

    table.handlePayload({ event: "session.created", id: 5, data: { id: 5, status: "active" } })
    table.handlePayload(updateFrame(5, "recording"))
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })

    expect(dispatched).toHaveBeenCalledTimes(1)
    const applied = dispatched.mock.calls[0]?.[0] as ParsedEventFrame | undefined
    expect(applied?.subject).toBe("session.updated")
  })

  it("waits the full window before flushing and opens a new window afterwards", () => {
    const { client, table, dispatched } = makeHarness()
    seededSessions(client, { id: 5, status: "s1" })

    table.handlePayload(updateFrame(5, "s2"))
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS - 1)
    })
    expect(dispatched).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(dispatched).toHaveBeenCalledTimes(1)

    table.handlePayload(updateFrame(5, "s3"))
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })
    expect(dispatched).toHaveBeenCalledTimes(2)
    expect(itemsOf(client)).toEqual([{ id: 5, status: "s3" }])
  })

  it("flushNow applies pending frames immediately and dispose drops them", () => {
    const first = makeHarness()
    seededSessions(first.client, { id: 5, status: "s1" })
    first.table.handlePayload(updateFrame(5, "s2"))
    first.table.flushNow()
    expect(first.dispatched).toHaveBeenCalledTimes(1)

    const second = makeHarness()
    seededSessions(second.client, { id: 5, status: "s1" })
    second.table.handlePayload(updateFrame(5, "s2"))
    second.table.dispose()
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS * 2)
    })
    expect(second.dispatched).not.toHaveBeenCalled()
  })

  it("rejects malformed payloads without buffering anything", () => {
    const { client, table, dispatched } = makeHarness()
    seededSessions(client, { id: 5, status: "s1" })

    expect(table.handlePayload("garbage")).toBe(false)
    expect(table.handlePayload({ event: "health.updated", id: 1 })).toBe(false)
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })
    expect(dispatched).not.toHaveBeenCalled()
  })
})

describe("one render pass for a five-frame burst", () => {
  it("writes the cache once so the subscribed view renders once", () => {
    const { client, table } = makeHarness()
    seededSessions(client, { id: 5, status: "s1" })

    const notifications = vi.fn()
    const unsubscribe = client.getQueryCache().subscribe(notifications)

    let renders = 0
    function SessionsWatcher() {
      const data = useSyncExternalStore(
        (onStoreChange) => client.getQueryCache().subscribe(onStoreChange),
        () => client.getQueryData<SeedData>(queryKeys.sessions()),
        () => client.getQueryData<SeedData>(queryKeys.sessions()),
      )
      renders += 1
      return <span data-testid="watched-status">{data?.pages[0]?.items[0]?.status ?? "none"}</span>
    }

    render(<SessionsWatcher />)
    expect(screen.getByTestId("watched-status").textContent).toBe("s1")
    const rendersBefore = renders
    notifications.mockClear()

    for (const status of ["s2", "s3", "s4", "s5", "s6"]) {
      table.handlePayload(updateFrame(5, status))
    }
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })

    expect(renders - rendersBefore).toBe(1)
    expect(notifications).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("watched-status").textContent).toBe("s6")
    unsubscribe()
  })
})

describe("installEventTable", () => {
  function installOn(
    harness: Harness,
    onSubscribe: (listener: (frame: RealtimeFrame) => void) => void,
  ): () => void {
    return installEventTable({
      store: harness.store,
      queryClient: harness.client,
      navigate: vi.fn(),
      isDetailOpen: () => false,
      invalidateNamesForEvent: vi.fn(),
      readPrefs: () => DEFAULT_NOTIFICATION_PREFS,
      subscribe: (next) => {
        onSubscribe(next)
        return () => {
          harness.unsubscribe()
        }
      },
    })
  }

  it("consumes only the events role and applies frames from the injected bus", () => {
    const harness = makeHarness()
    seededSessions(harness.client, { id: 5, status: "s1" })
    let listener: ((frame: RealtimeFrame) => void) | null = null
    const emit = (frame: RealtimeFrame): void => {
      if (listener !== null) listener(frame)
    }
    const stop = installOn(harness, (next) => {
      listener = next
    })

    emit({ role: "notifications", payload: updateFrame(5, "ignored") })
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })
    expect(itemsOf(harness.client)).toEqual([{ id: 5, status: "s1" }])

    emit({ role: "events", payload: updateFrame(5, "recording") })
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })
    expect(itemsOf(harness.client)).toEqual([{ id: 5, status: "recording" }])

    stop()
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("ignores malformed frames on the real bus without throwing", () => {
    const harness = makeHarness()
    seededSessions(harness.client, { id: 5, status: "s1" })
    let listener: ((frame: RealtimeFrame) => void) | null = null
    const emit = (frame: RealtimeFrame): void => {
      if (listener !== null) listener(frame)
    }
    const stop = installOn(harness, (next) => {
      listener = next
    })

    expect(() => emit({ role: "events", payload: "not json at all" })).not.toThrow()
    expect(() => emit({ role: "events", payload: { event: "session.updated" } })).not.toThrow()
    act(() => {
      vi.advanceTimersByTime(EVENT_COALESCE_MS)
    })
    expect(itemsOf(harness.client)).toEqual([{ id: 5, status: "s1" }])
    stop()
  })
})
