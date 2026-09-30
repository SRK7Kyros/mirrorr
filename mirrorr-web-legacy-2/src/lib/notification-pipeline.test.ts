/**
 * Todo 20 — the `/ws/notifications` pipeline, exactly as written in
 * `docs/web-frontend-spec.md` L195 (connect flush + push, tuple dedupe, badge
 * arithmetic never depends on the socket) and contract §11.2/§13.10.2 (the
 * frame carries `resource_type/resource_id/event_type/title/created_at`; the
 * client must not require or read `id`/`body`/`read`).
 */
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  countPendingSyntheticNotifications,
  getSyntheticNotifications,
  resetSyntheticNotifications,
} from "@/lib/notification-policy"
import {
  NOTIFICATION_FLUSH_COALESCE_MS,
  installNotificationPipeline,
  parseNotificationFrame,
} from "@/lib/notification-pipeline"
import { queryKeys } from "@/lib/query-keys"
import type { RealtimeFrame } from "@/lib/realtime-manager"
import { getRealtimeStatus, resetRealtimeStatus, setRealtimeStatus, type RealtimeStatus } from "@/lib/realtime-status"
import { clearToasts, getToasts } from "@/lib/toast"

const CRASH_FRAME = {
  type: "notification",
  data: {
    id: 501,
    user_id: 1,
    resource_type: "session",
    resource_id: 5,
    event_type: "session.crashed",
    title: "session 5: session.crashed",
    body: "",
    read: false,
    created_at: "2026-09-20T00:00:00Z",
  },
}

function makeFrameBus() {
  let listener: ((frame: RealtimeFrame) => void) | null = null
  return {
    subscribe: (next: (frame: RealtimeFrame) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
    emit: (frame: RealtimeFrame) => listener?.(frame),
    emitNotification: (payload: unknown) => listener?.({ role: "notifications", payload }),
  }
}

function makeStatusBus() {
  let listener: (() => void) | null = null
  let status: RealtimeStatus = "offline"
  return {
    subscribe: (next: () => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
    getStatus: () => status,
    set: (next: RealtimeStatus) => {
      status = next
      listener?.()
    },
  }
}

interface Harness {
  readonly client: QueryClient
  readonly bus: ReturnType<typeof makeFrameBus>
  readonly status: ReturnType<typeof makeStatusBus>
  readonly uninstall: () => void
}

function makeHarness(): Harness {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const bus = makeFrameBus()
  const status = makeStatusBus()
  const uninstall = installNotificationPipeline({
    queryClient: client,
    subscribe: bus.subscribe,
    subscribeStatus: status.subscribe,
    getStatus: status.getStatus,
  })
  vi.spyOn(client, "invalidateQueries")
  return { client, bus, status, uninstall }
}

function flushWindow(): void {
  vi.advanceTimersByTime(NOTIFICATION_FLUSH_COALESCE_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetSyntheticNotifications()
  clearToasts()
  resetRealtimeStatus()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("parseNotificationFrame", () => {
  it("keeps the spec's frame fields and ignores id/body/read", () => {
    expect(parseNotificationFrame(CRASH_FRAME)).toEqual({
      resource_type: "session",
      resource_id: 5,
      event_type: "session.crashed",
      title: "session 5: session.crashed",
      created_at: "2026-09-20T00:00:00Z",
    })
  })

  it("accepts frames whose resource fields are null or absent", () => {
    expect(
      parseNotificationFrame({
        type: "notification",
        data: { resource_type: null, resource_id: null, event_type: "session.stopped", title: "stopped" },
      }),
    ).toEqual({ event_type: "session.stopped", title: "stopped" })
  })

  it("rejects malformed frames without throwing", () => {
    expect(parseNotificationFrame(null)).toBeNull()
    expect(parseNotificationFrame("nope")).toBeNull()
    expect(parseNotificationFrame({})).toBeNull()
    expect(parseNotificationFrame({ type: "event", event: "session.updated", id: 5 })).toBeNull()
    expect(parseNotificationFrame({ type: "notification" })).toBeNull()
    expect(parseNotificationFrame({ type: "notification", data: { event_type: "a" } })).toBeNull()
    expect(parseNotificationFrame({ type: "notification", data: { event_type: 1, title: "x" } })).toBeNull()
    expect(parseNotificationFrame({ type: "other", data: { event_type: "a", title: "b" } })).toBeNull()
  })
})

describe("installNotificationPipeline", () => {
  it("flushes a pushed notification into the badge, toasts it, and refreshes the drawer feed", () => {
    const { client, bus, uninstall } = makeHarness()

    bus.emitNotification(CRASH_FRAME)

    expect(getSyntheticNotifications()).toHaveLength(1)
    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [])).toBe(1)
    expect(getToasts().map((toast) => toast.message)).toEqual(["session 5: session.crashed"])

    expect(client.invalidateQueries).not.toHaveBeenCalled()
    flushWindow()
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.notifications() })

    uninstall()
  })

  it("ignores events-role frames and malformed notification payloads", () => {
    const { client, bus, uninstall } = makeHarness()

    bus.emit({ role: "events", payload: CRASH_FRAME })
    bus.emitNotification({ type: "notification", data: { title: "no event type" } })
    bus.emitNotification("garbage")
    flushWindow()

    expect(getSyntheticNotifications()).toHaveLength(0)
    expect(getToasts()).toHaveLength(0)
    expect(client.invalidateQueries).not.toHaveBeenCalled()

    uninstall()
  })

  it("counts a duplicated tuple once and coalesces its refresh", () => {
    const { client, bus, uninstall } = makeHarness()

    bus.emitNotification(CRASH_FRAME)
    bus.emitNotification(CRASH_FRAME)
    flushWindow()

    expect(getSyntheticNotifications()).toHaveLength(1)
    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [])).toBe(1)
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1)

    uninstall()
  })

  it("re-flushes on the reconnect-to-live transition without duplicating badge or rows", () => {
    const { client, bus, status, uninstall } = makeHarness()

    bus.emitNotification(CRASH_FRAME)
    flushWindow()
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1)

    status.set("reconnecting")
    status.set("live")
    flushWindow()
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2)

    bus.emitNotification(CRASH_FRAME)
    flushWindow()
    expect(getSyntheticNotifications()).toHaveLength(1)
    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [])).toBe(1)
    expect(client.invalidateQueries).toHaveBeenCalledTimes(3)

    uninstall()
  })

  it("does not re-flush when the status was already live", () => {
    const { client, status, uninstall } = makeHarness()

    status.set("live")
    flushWindow()
    status.set("live")
    flushWindow()
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1)

    uninstall()
  })

  it("hooks the real status module's reconnect transition by default", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const uninstall = installNotificationPipeline({ queryClient: client })
    const invalidate = vi.spyOn(client, "invalidateQueries")

    expect(getRealtimeStatus()).toBe("offline")
    setRealtimeStatus("live")
    flushWindow()
    expect(invalidate).toHaveBeenCalledTimes(1)

    setRealtimeStatus("reconnecting")
    setRealtimeStatus("live")
    flushWindow()
    expect(invalidate).toHaveBeenCalledTimes(2)

    uninstall()
    setRealtimeStatus("reconnecting")
    setRealtimeStatus("live")
    flushWindow()
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it("detaches the frame and status subscriptions on teardown", () => {
    const { bus, status, uninstall } = makeHarness()

    uninstall()
    bus.emitNotification(CRASH_FRAME)
    status.set("live")
    flushWindow()

    expect(getSyntheticNotifications()).toHaveLength(0)
  })
})
