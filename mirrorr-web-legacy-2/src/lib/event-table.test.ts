/**
 * Todo 19 — the `/ws/events` subject→reaction table, exactly as written in
 * `docs/web-frontend-spec.md` L165-L181 (frame handling + subject table +
 * toasts) and L183-L189 (merge + cross-client), contract §11.1. Todo 20 adds
 * the `session.{id}.remux.progress` side-channel (L189, L193, §13.4): the
 * frame never merges into a cache; it is published with the subject id
 * injected as `session_id` for the open detail's progress store.
 *
 * Step 1 of the TDD cycle: loose Zod parsing, the per-subject cache reaction,
 * `data`-authoritative writes, data-less refetch-once and the toast policy.
 * The 30ms coalescing buffer + frame-bus installation live in
 * `event-coalescer.test.ts` (step 2).
 */
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_NOTIFICATION_PREFS,
  writeNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/notification-policy"
import { EntityStore, type EntityFrame, type EntityResource } from "@/lib/entity-store"
import { EventTable, parseEventFrame, type ParsedEventFrame } from "@/lib/event-table"
import { queryKeys } from "@/lib/query-keys"
import {
  activateRemuxProgress,
  applyRemuxProgressFrame,
  deactivateRemuxProgress,
  getRemuxProgress,
} from "@/lib/remux-progress"
import { isRemuxProgressEvent, subscribeSessionFrames } from "@/lib/session-frames"
import { clearToasts, getToasts } from "@/lib/toast"

interface Row {
  readonly id: number
  readonly status?: string
  readonly [field: string]: unknown
}

interface SeedPage {
  readonly items: readonly Row[]
  readonly next_cursor: null
  readonly has_more: false
}

interface SeedData {
  readonly pages: readonly SeedPage[]
  readonly pageParams: readonly null[]
}

function infinitePage(...pages: readonly (readonly Row[])[]): SeedData {
  return {
    pages: pages.map((items) => ({ items, next_cursor: null, has_more: false })),
    pageParams: pages.map(() => null),
  }
}

function rawFrame(fields: Record<string, unknown>): Record<string, unknown> {
  return { type: "event", ...fields }
}

function parsed(fields: Record<string, unknown>): ParsedEventFrame {
  const frame = parseEventFrame(rawFrame(fields))
  if (frame === null) throw new Error(`expected frame to parse: ${JSON.stringify(fields)}`)
  return frame
}

function itemsOf(client: QueryClient, key: readonly unknown[]): readonly Row[] {
  const data = client.getQueryData<SeedData>(key)
  return data?.pages.flatMap((page) => page.items) ?? []
}

interface Harness {
  readonly client: QueryClient
  readonly store: EntityStore
  readonly table: EventTable
  readonly refetchEntity: ReturnType<typeof vi.fn>
  readonly navigate: ReturnType<typeof vi.fn>
  readonly invalidateNamesForEvent: ReturnType<typeof vi.fn>
}

interface HarnessOptions {
  readonly refetchEntity?: (resource: EntityResource, id: number) => Promise<void>
  readonly isDetailOpen?: (resource: "session" | "autorun", id: number) => boolean
  readonly prefs?: NotificationPrefs
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const refetchEntity = vi.fn(options.refetchEntity ?? (async () => undefined))
  const store = new EntityStore({ queryClient: client, refetchEntity })
  const navigate = vi.fn()
  const invalidateNamesForEvent = vi.fn()
  const table = new EventTable({
    store,
    queryClient: client,
    navigate,
    isDetailOpen: options.isDetailOpen ?? (() => false),
    invalidateNamesForEvent,
    readPrefs: () => options.prefs ?? DEFAULT_NOTIFICATION_PREFS,
  })
  return { client, store, table, refetchEntity, navigate, invalidateNamesForEvent }
}

beforeEach(() => {
  window.localStorage.clear()
  clearToasts()
})

afterEach(() => {
  clearToasts()
  vi.restoreAllMocks()
})

describe("parseEventFrame (loose Zod)", () => {
  it("accepts the relay's shape with hint fields and enrichment keys present", () => {
    const frame = parseEventFrame(
      rawFrame({
        event_id: "abc",
        timestamp: "2026-09-20T00:00:00Z",
        origin: "mirrorr-core",
        event: "session.updated",
        id: 5,
        status: "recording",
        recording: true,
        data: { id: 5, status: "recording", secret_extra: 1 },
      }),
    )

    expect(frame).toEqual({
      subject: "session.updated",
      resource: "session",
      action: "updated",
      id: 5,
      data: { id: 5, status: "recording", secret_extra: 1 },
    })
  })

  it("resolves the id from the enriched data when top-level id is missing", () => {
    const frame = parseEventFrame(rawFrame({ event: "recording.created", data: { id: 9 } }))
    expect(frame?.id).toBe(9)
  })

  it("treats data:null as data-less (deleted frames and update races)", () => {
    const frame = parseEventFrame(rawFrame({ event: "session.updated", id: 5, data: null }))
    expect(frame?.data).toBeNull()
  })

  it("rejects malformed frames without throwing", () => {
    expect(parseEventFrame(null)).toBeNull()
    expect(parseEventFrame("nope")).toBeNull()
    expect(parseEventFrame(42)).toBeNull()
    expect(parseEventFrame({})).toBeNull()
    expect(parseEventFrame(rawFrame({ event: 42, id: 5 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.updated" }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.updated", id: "5" }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.updated", id: 5.5 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.updated", id: 5, data: "broken" }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.updated", id: 5, data: [1, 2] }))).toBeNull()
  })

  it("ignores subjects outside the event catalog (progress is todo 20)", () => {
    expect(parseEventFrame(rawFrame({ event: "health.updated", id: 1 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.5.remux.progress", data: { session_id: 5 } }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "notification.created", id: 3 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.telemetry", id: 5 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "session.bogus", id: 5 }))).toBeNull()
    expect(parseEventFrame(rawFrame({ event: "profile.archived", id: 5 }))).toBeNull()
  })
})

describe("session.* reactions", () => {
  it("session.created inserts into the sessions first page and patches the spawning autorun row", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 1, status: "completed" }]))
    client.setQueryData(
      queryKeys.autoruns(),
      infinitePage([{ id: 3, status: "scheduled", user_friendly_name: "Nightly" }]),
    )

    table.dispatch(
      parsed({
        event: "session.created",
        id: 9,
        data: { id: 9, status: "active", autorun_id: 3, engine_id: 1, resolver_id: 1 },
      }),
    )

    expect(itemsOf(client, queryKeys.sessions()).map((row) => row.id)).toEqual([9, 1])
    expect(itemsOf(client, queryKeys.autoruns())).toEqual([
      { id: 3, status: "active", user_friendly_name: "Nightly" },
    ])
  })

  it("session.created without an autorun touches no autorun cache", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.sessions(), infinitePage([]))
    client.setQueryData(queryKeys.autoruns(), infinitePage([{ id: 3, status: "scheduled" }]))

    table.dispatch(
      parsed({ event: "session.created", id: 9, data: { id: 9, status: "active", engine_id: 1, resolver_id: 1 } }),
    )

    expect(itemsOf(client, queryKeys.autoruns())).toEqual([{ id: 3, status: "scheduled" }])
  })

  it("session.updated patches the detail and every cached session page occurrence", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 5, status: "active" }], [{ id: 5, status: "active" }]))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active", recording: false })

    table.dispatch(
      parsed({ event: "session.updated", id: 5, data: { id: 5, status: "recording", recording: true } }),
    )

    expect(client.getQueryData(queryKeys.session(5))).toMatchObject({ status: "recording", recording: true })
    const rows = itemsOf(client, queryKeys.sessions())
    expect(rows).toEqual([
      { id: 5, status: "recording", recording: true },
      { id: 5, status: "recording", recording: true },
    ])
  })

  it("data-less session.updated refetches once and writes NO fields from the top-level hints", () => {
    const { client, table, refetchEntity } = makeHarness()
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 5, status: "active" }]))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active" })

    table.dispatch(parsed({ event: "session.updated", id: 5, status: "failed" }))
    table.dispatch(parsed({ event: "session.updated", id: 5, status: "failed" }))

    expect(refetchEntity).toHaveBeenCalledTimes(1)
    expect(refetchEntity).toHaveBeenCalledWith("session", 5)
    expect(client.getQueryData(queryKeys.session(5))).toEqual({ id: 5, status: "active" })
    expect(itemsOf(client, queryKeys.sessions())).toEqual([{ id: 5, status: "active" }])
  })

  it("data-less session.started and session.stopped each refetch exactly once", () => {
    const { table, refetchEntity } = makeHarness()

    table.dispatch(parsed({ event: "session.started", id: 5 }))
    expect(refetchEntity).toHaveBeenCalledWith("session", 5)
    expect(refetchEntity).toHaveBeenCalledTimes(1)

    table.dispatch(parsed({ event: "session.stopped", id: 6 }))
    expect(refetchEntity).toHaveBeenCalledWith("session", 6)
    expect(refetchEntity).toHaveBeenCalledTimes(2)
  })

  it("session.crashed patches the row and refetches an open detail exactly once", async () => {
    const { client, table } = makeHarness()
    const detailFetch = vi.fn(async () => ({ id: 5, status: "active" }))
    await client.fetchQuery({ queryKey: queryKeys.session(5), queryFn: detailFetch })
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 5, status: "active" }]))

    table.dispatch(parsed({ event: "session.crashed", id: 5, data: { id: 5, status: "failed" } }))

    expect(client.getQueryData(queryKeys.session(5))).toEqual({ id: 5, status: "failed" })
    expect(detailFetch).toHaveBeenCalledTimes(2)
    expect(itemsOf(client, queryKeys.sessions())).toEqual([{ id: 5, status: "failed" }])
  })

  it("session.crashed without data refetches once and still raises the error toast", () => {
    const { table, refetchEntity } = makeHarness()

    table.dispatch(parsed({ event: "session.crashed", id: 5 }))

    expect(refetchEntity).toHaveBeenCalledTimes(1)
    expect(refetchEntity).toHaveBeenCalledWith("session", 5)
    expect(getToasts().map((toast) => toast.message)).toEqual(["Session #5 failed"])
  })

  it("session.deleted removes every session cache and navigates when the detail is open", () => {
    const { client, table, navigate } = makeHarness({ isDetailOpen: (resource, id) => resource === "session" && id === 5 })
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 5 }, { id: 6 }]))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "active" })

    table.dispatch(parsed({ event: "session.deleted", id: 5 }))

    expect(itemsOf(client, queryKeys.sessions())).toEqual([{ id: 6 }])
    expect(client.getQueryData(queryKeys.session(5))).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith("/sessions")
  })

  it("session.deleted never navigates when the detail is not open", () => {
    const { table, navigate } = makeHarness({ isDetailOpen: () => false })
    table.dispatch(parsed({ event: "session.deleted", id: 5 }))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe("autorun.* / recording.* / profile.* reactions", () => {
  it("autorun.created and autorun.updated upsert the autorun caches", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.autoruns(), infinitePage([{ id: 3, status: "scheduled" }]))

    table.dispatch(parsed({ event: "autorun.updated", id: 3, data: { id: 3, status: "active" } }))
    table.dispatch(
      parsed({ event: "autorun.created", id: 4, data: { id: 4, status: "scheduled", user_friendly_name: "New" } }),
    )

    expect(itemsOf(client, queryKeys.autoruns())).toEqual([
      { id: 4, status: "scheduled", user_friendly_name: "New" },
      { id: 3, status: "active" },
    ])
  })

  it("autorun.deleted removes the row and navigates when the autorun detail is open", () => {
    const { client, table, navigate } = makeHarness({ isDetailOpen: (resource, id) => resource === "autorun" && id === 3 })
    client.setQueryData(queryKeys.autoruns(), infinitePage([{ id: 3 }, { id: 4 }]))

    table.dispatch(parsed({ event: "autorun.deleted", id: 3 }))

    expect(itemsOf(client, queryKeys.autoruns())).toEqual([{ id: 4 }])
    expect(navigate).toHaveBeenCalledWith("/autoruns")
  })

  it("recording.created invalidates the recordings family instead of inserting", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.recordings(), infinitePage([]))

    table.dispatch(parsed({ event: "recording.created", id: 9, data: { id: 9, user_friendly_name: "take" } }))

    expect(client.getQueryState(queryKeys.recordings())?.isInvalidated).toBe(true)
    expect(itemsOf(client, queryKeys.recordings())).toEqual([])
    expect(getToasts()[0]).toMatchObject({
      message: "Recording saved",
      tone: "info",
      action: { label: "Open", href: "/recordings?highlight=9" },
    })
  })

  it("recording.updated patches and recording.deleted removes the cached rows", () => {
    const { client, table } = makeHarness()
    client.setQueryData(queryKeys.recordings(), infinitePage([{ id: 9, user_friendly_name: "take" }]))

    table.dispatch(parsed({ event: "recording.updated", id: 9, data: { id: 9, user_friendly_name: "renamed" } }))
    expect(itemsOf(client, queryKeys.recordings())).toEqual([{ id: 9, user_friendly_name: "renamed" }])

    table.dispatch(parsed({ event: "recording.deleted", id: 9 }))
    expect(itemsOf(client, queryKeys.recordings())).toEqual([])
    expect(getToasts()).toHaveLength(0)
  })

  it("profile.created/updated/deleted invalidate the profiles family and the name memo-map", () => {
    const { client, table, invalidateNamesForEvent } = makeHarness()
    client.setQueryData(queryKeys.profiles(), infinitePage([{ id: 7, name: "p1" }]))

    for (const subject of ["profile.created", "profile.updated", "profile.deleted"]) {
      table.dispatch(parsed({ event: subject, id: 8, data: { id: 8, name: "p2" } }))
      expect(invalidateNamesForEvent).toHaveBeenCalledWith(subject)
    }

    expect(client.getQueryState(queryKeys.profiles())?.isInvalidated).toBe(true)
    expect(itemsOf(client, queryKeys.profiles())).toEqual([{ id: 7, name: "p1" }])
    expect(getToasts()).toHaveLength(0)
  })

  it("ignores subjects outside the table without touching a cache", () => {
    const { table, refetchEntity, invalidateNamesForEvent } = makeHarness()
    expect(table.handlePayload(rawFrame({ event: "health.updated", id: 1 }))).toBe(false)
    expect(table.handlePayload(rawFrame({ event: "session.5.control" }))).toBe(false)
    expect(table.handlePayload("garbage")).toBe(false)
    expect(refetchEntity).not.toHaveBeenCalled()
    expect(invalidateNamesForEvent).not.toHaveBeenCalled()
  })
})

describe("remux progress side-channel (spec L189/L193, contract §13.4)", () => {
  const FLAT_FRAME = {
    type: "event",
    event: "session.5.remux.progress",
    percent: 42.5,
    eta_seconds: 30,
    speed: "1.5x",
    frame: 100,
    current_time: 12.3,
    total_duration: 60,
    elapsed: 5,
  }

  it("publishes the flat frame with the subject id injected, never merging it into a cache", () => {
    const { client, table, refetchEntity } = makeHarness()
    const published: EntityFrame[] = []
    const unsubscribe = subscribeSessionFrames((frame) => published.push(frame))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "remuxing" })
    client.setQueryData(queryKeys.sessions(), infinitePage([{ id: 5, status: "remuxing" }]))

    expect(table.handlePayload(rawFrame(FLAT_FRAME))).toBe(true)

    expect(published).toEqual([
      {
        event: "session.5.remux.progress",
        id: 5,
        data: {
          percent: 42.5,
          eta_seconds: 30,
          speed: "1.5x",
          frame: 100,
          current_time: 12.3,
          total_duration: 60,
          elapsed: 5,
          session_id: 5,
          id: 5,
        },
      },
    ])
    expect(client.getQueryData(queryKeys.session(5))).toEqual({ id: 5, status: "remuxing" })
    expect(itemsOf(client, queryKeys.sessions())).toEqual([{ id: 5, status: "remuxing" }])
    expect(refetchEntity).not.toHaveBeenCalled()

    unsubscribe()
  })

  it("applies the open session's progress and drops an unopened session's frame", () => {
    const { table } = makeHarness()
    const unsubscribe = subscribeSessionFrames((frame) => {
      if (!isRemuxProgressEvent(frame.event)) return
      applyRemuxProgressFrame(frame.data)
    })
    activateRemuxProgress(47)

    table.handlePayload(rawFrame({ ...FLAT_FRAME, event: "session.47.remux.progress" }))
    expect(getRemuxProgress(47)?.percent).toBe(42.5)
    expect(getRemuxProgress(47)?.etaSeconds).toBe(30)

    table.handlePayload(rawFrame({ ...FLAT_FRAME, event: "session.48.remux.progress", percent: 99 }))
    expect(getRemuxProgress(48)).toBeNull()
    expect(getRemuxProgress(47)?.percent).toBe(42.5)

    deactivateRemuxProgress(47)
    unsubscribe()
  })

  it("publishes progress immediately and never masks a same-id session.updated in the coalescer", () => {
    const { client, table } = makeHarness()
    const published: EntityFrame[] = []
    const unsubscribe = subscribeSessionFrames((frame) => published.push(frame))
    client.setQueryData(queryKeys.session(5), { id: 5, status: "remuxing" })

    table.handlePayload(rawFrame(FLAT_FRAME))
    table.handlePayload(rawFrame({ event: "session.updated", id: 5, data: { id: 5, status: "finalizing" } }))

    expect(published.map((frame) => frame.event)).toEqual(["session.5.remux.progress"])
    table.flushNow()
    expect(client.getQueryData(queryKeys.session(5))).toMatchObject({ status: "finalizing" })

    unsubscribe()
  })

  it("rejects remux-shaped frames with a non-numeric or missing subject id", () => {
    const { table } = makeHarness()
    expect(table.handlePayload(rawFrame({ event: "session.abc.remux.progress", percent: 1 }))).toBe(false)
    expect(table.handlePayload(rawFrame({ event: "session.remux.progress", percent: 1 }))).toBe(false)
  })
})

describe("toast policy (spec L165-L181, user-configurable)", () => {
  const allOff: NotificationPrefs = { crashes: false, completions: false, recordings: false }
  const allOn: NotificationPrefs = { crashes: true, completions: true, recordings: true }

  it("toasts a session spawned from an autorun with the cached autorun name", () => {
    const { client, table } = makeHarness({ prefs: allOn })
    client.setQueryData(queryKeys.autoruns(), infinitePage([{ id: 3, user_friendly_name: "Nightly" }]))

    table.dispatch(
      parsed({ event: "session.created", id: 9, data: { id: 9, status: "active", autorun_id: 3 } }),
    )

    expect(getToasts().map((toast) => toast.message)).toEqual(["Autorun 'Nightly' started"])
    expect(getToasts()[0]?.tone).toBe("info")
  })

  it("falls back to the autorun id when the row is not cached, and stays silent for a manual session", () => {
    const { table } = makeHarness({ prefs: allOn })
    table.dispatch(parsed({ event: "session.created", id: 9, data: { id: 9, status: "active", autorun_id: 4 } }))
    table.dispatch(parsed({ event: "session.created", id: 10, data: { id: 10, status: "active" } }))

    expect(getToasts().map((toast) => toast.message)).toEqual(["Autorun '#4' started"])
  })

  it("toasts a completed update only while the completions preference is on", () => {
    const on = makeHarness({ prefs: allOn })
    on.table.dispatch(parsed({ event: "session.updated", id: 5, data: { id: 5, status: "completed" } }))
    expect(getToasts().map((toast) => toast.message)).toEqual(["Session #5 completed"])

    clearToasts()
    const off = makeHarness({ prefs: { ...allOff } })
    off.table.dispatch(parsed({ event: "session.updated", id: 5, data: { id: 5, status: "completed" } }))
    expect(getToasts()).toHaveLength(0)
  })

  it("never toasts a non-completed update, started, stopped or updated-without-data", () => {
    const { table } = makeHarness({ prefs: allOn })
    table.dispatch(parsed({ event: "session.updated", id: 5, data: { id: 5, status: "recording" } }))
    table.dispatch(parsed({ event: "session.started", id: 5, data: { id: 5, status: "active" } }))
    table.dispatch(parsed({ event: "session.stopped", id: 5, data: { id: 5, status: "completed" } }))
    table.dispatch(parsed({ event: "session.updated", id: 5 }))
    expect(getToasts()).toHaveLength(0)
  })

  it("gates the crash error toast on the crashes preference", () => {
    const on = makeHarness({ prefs: { ...allOff, crashes: true } })
    on.table.dispatch(parsed({ event: "session.crashed", id: 5, data: { id: 5, status: "failed" } }))
    expect(getToasts()[0]).toMatchObject({ message: "Session #5 failed", tone: "error" })

    clearToasts()
    const off = makeHarness({ prefs: { ...allOff, crashes: false } })
    off.table.dispatch(parsed({ event: "session.crashed", id: 5, data: { id: 5, status: "failed" } }))
    expect(getToasts()).toHaveLength(0)
  })

  it("gates the recording-saved toast on the recordings preference", () => {
    const on = makeHarness({ prefs: allOn })
    on.table.dispatch(parsed({ event: "recording.created", id: 9 }))
    expect(getToasts()[0]?.message).toBe("Recording saved")

    clearToasts()
    writeNotificationPrefs({ crashes: true, completions: true, recordings: false })
    const off = makeHarness({ prefs: { ...allOn, recordings: false } })
    off.table.dispatch(parsed({ event: "recording.created", id: 9 }))
    expect(getToasts()).toHaveLength(0)
  })
})
