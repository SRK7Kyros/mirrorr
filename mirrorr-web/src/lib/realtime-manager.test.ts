import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  RealtimeManager,
  backoffDelay,
  wsEndpoint,
  type WebSocketConstructor,
  type WebSocketLike,
} from "./realtime-manager"

class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.(new Event("open"))
  }

  drop(code: number): void {
    this.onclose?.(new CloseEvent("close", { code }))
  }

  message(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }))
  }
}

const MockCtor: WebSocketConstructor = MockWebSocket

function lastInstance(): MockWebSocket {
  const instance = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  if (instance === undefined) throw new Error("no MockWebSocket instances")
  return instance
}

describe("backoff ladder", () => {
  it("follows 1s → 2s → 4s → 8s → 16s → 30s cap", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ])
  })
})

describe("wsEndpoint", () => {
  it("uses the page origin when the API base is root-relative (default /api)", () => {
    vi.stubEnv("VITE_API_URL", "/api")
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:"
    expect(wsEndpoint("/ws/events")).toBe(`${wsProto}//${window.location.host}/ws/events`)
    expect(wsEndpoint("/ws/notifications")).toBe(
      `${wsProto}//${window.location.host}/ws/notifications`,
    )
    vi.unstubAllEnvs()
  })

  it("derives the ws URL from an absolute API origin, path untouched", () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:8000")
    expect(wsEndpoint("/ws/events")).toBe("ws://127.0.0.1:8000/ws/events")
    expect(wsEndpoint("/ws/notifications")).toBe("ws://127.0.0.1:8000/ws/notifications")
    vi.unstubAllEnvs()
  })
})

describe("RealtimeManager", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createManager(
    overrides: Partial<ConstructorParameters<typeof RealtimeManager>[0]> = {},
  ): RealtimeManager {
    return new RealtimeManager({ webSocketImpl: MockCtor, ...overrides })
  }

  it("opens both sockets after start and marks them open", () => {
    const manager = createManager()
    manager.start(true)

    expect(MockWebSocket.instances).toHaveLength(2)
    expect(MockWebSocket.instances[0]?.url).toContain("/ws/events")
    expect(MockWebSocket.instances[1]?.url).toContain("/ws/notifications")
    MockWebSocket.instances[0]?.open()
    MockWebSocket.instances[1]?.open()
    expect(manager.getState()).toMatchObject({
      events: "open",
      notifications: "open",
      attempts: 0,
      pollingFallback: false,
    })
    manager.stop()
  })

  it("skips the notifications socket for API-client principals", () => {
    const manager = createManager()
    manager.start(false)

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(manager.getState().notifications).toBe("skipped")
    manager.stop()
  })

  it("reconnects with exponential backoff and resets attempts on open", () => {
    const manager = createManager()
    manager.start(false)

    lastInstance().drop(1006)
    expect(manager.getState()).toMatchObject({ attempts: 1, events: "reconnecting" })

    vi.advanceTimersByTime(999)
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(2)

    lastInstance().open()
    expect(manager.getState()).toMatchObject({ attempts: 0, events: "open" })
    manager.stop()
  })

  it("refreshes once on close 4001 then reconnects", async () => {
    vi.useRealTimers()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const manager = createManager({ refresh })
    manager.start(false)

    lastInstance().drop(4001)
    await Promise.resolve()
    await Promise.resolve()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(MockWebSocket.instances.length).toBe(2)
    expect(manager.getState().attempts).toBe(0)
    expect(manager.getState().events).not.toBe("closed")
    manager.stop()
  })

  it("invokes onAuthFailure when the 4001 refresh fails", async () => {
    vi.useRealTimers()
    const refresh = vi.fn().mockRejectedValue(new Error("refresh failed"))
    const onAuthFailure = vi.fn()
    const manager = createManager({ refresh, onAuthFailure })
    manager.start(false)

    lastInstance().drop(4001)
    await Promise.resolve()
    await Promise.resolve()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onAuthFailure).toHaveBeenCalledTimes(1)
    manager.stop()
  })

  it("enters the polling fallback after 12 failed attempts, then retry() recovers", () => {
    const manager = createManager()
    manager.start(false)

    for (let attempt = 0; attempt < 12; attempt += 1) {
      lastInstance().drop(1006)
      vi.advanceTimersByTime(30_000)
    }

    expect(manager.getState()).toMatchObject({ pollingFallback: true, events: "polling" })
    const countAtFallback = MockWebSocket.instances.length
    vi.advanceTimersByTime(120_000)
    expect(MockWebSocket.instances).toHaveLength(countAtFallback)

    manager.retry()
    expect(manager.getState()).toMatchObject({ pollingFallback: false, attempts: 0 })
    expect(MockWebSocket.instances).toHaveLength(countAtFallback + 1)
    manager.stop()
  })

  it("closes sockets on stop (logout)", () => {
    const manager = createManager()
    manager.start(true)
    const events = MockWebSocket.instances[0]
    events?.open()
    expect(manager.getState().events).toBe("open")

    manager.stop()

    expect(events?.closed).toBe(true)
    expect(manager.getState().events).toBe("closed")
    expect(manager.getState().pollingFallback).toBe(false)
  })

  it("routes frames to the registered handlers", () => {
    const onEvent = vi.fn()
    const onNotification = vi.fn()
    const manager = createManager()
    manager.setFrameHandlers({ onEvent, onNotification })
    manager.start(true)

    const eventsSocket = MockWebSocket.instances[0]
    const notificationSocket = MockWebSocket.instances[1]
    const eventFrame = JSON.stringify({ type: "event", event: "session.updated", id: 1 })
    const notificationFrame = JSON.stringify({ type: "notification", data: { title: "hi" } })
    eventsSocket?.message(eventFrame)
    notificationSocket?.message(notificationFrame)

    expect(onEvent).toHaveBeenCalledWith({ type: "event", event: "session.updated", id: 1 })
    expect(onNotification).toHaveBeenCalledWith({
      type: "notification",
      data: { title: "hi" },
    })
    manager.stop()
  })
})
