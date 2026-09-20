/**
 * Todo 18 acceptance: the RealtimeManager owns both sockets, never sends
 * frames, watches server silence, reconnects with the spec's capped backoff
 * (1→2→4→8→16→30s, max 12 attempts), handles close `4001` (refresh once,
 * second 4001 → logout) and `1013` (backoff retry), drives the connection-dot
 * seam, and shuts down cleanly on logout.
 *
 * Contract: `docs/web-frontend-spec.md` L162-L171 (connections, reconnect
 * policy, dot states), L589 (WS URL derivation),
 * `docs/general-client-specification.md` §11.1-§11.2 (client never sends
 * frames; server-push only) and §13.9.6 (close codes).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearAuthSession, setAuthSession } from "@/lib/auth-store"
import {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF_MS,
  RealtimeManager,
  SOCKET_SILENCE_TIMEOUT_MS,
  subscribeRealtimeFrames,
  type RealtimeFrame,
  type RealtimeManagerOptions,
  type RealtimeSocket,
} from "@/lib/realtime-manager"
import { resetRealtimeStatus, type RealtimeStatus } from "@/lib/realtime-status"
import { AUTH_BODY } from "@/test/api-helpers"

const EVENTS_URL = "ws://mirrorr.test/ws/events"
const NOTIFICATIONS_URL = "ws://mirrorr.test/ws/notifications"
const SILENCE_MS = SOCKET_SILENCE_TIMEOUT_MS

// ---------------------------------------------------------------------------
// Fakes: a deterministic timer queue, assignable WebSocket doubles, a fake
// principal store. No fake timers are used, so promise microtasks stay real.
// ---------------------------------------------------------------------------

interface ScheduledTimer {
  readonly handle: number
  readonly at: number
  readonly callback: () => void
}

class TestClock {
  private readonly timers = new Map<number, { readonly at: number; readonly callback: () => void }>()
  private nextHandle = 1
  private currentTime = 0

  /** Every delay scheduled, in order (silence timers included). */
  readonly delays: number[] = []

  readonly setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.delays.push(delayMs)
    this.timers.set(handle, { at: this.currentTime + delayMs, callback })
    return handle
  }

  readonly clearTimeout = (handle: number): void => {
    this.timers.delete(handle)
  }

  advance(ms: number): void {
    const target = this.currentTime + ms
    for (;;) {
      const due = this.nextDue(target)
      if (due === null) break
      this.timers.delete(due.handle)
      this.currentTime = due.at
      due.callback()
    }
    this.currentTime = target
  }

  private nextDue(target: number): ScheduledTimer | null {
    let best: ScheduledTimer | null = null
    for (const [handle, timer] of this.timers) {
      if (timer.at > target) continue
      if (best === null || timer.at < best.at || (timer.at === best.at && handle < best.handle)) {
        best = { handle, at: timer.at, callback: timer.callback }
      }
    }
    return best
  }
}

class FakeSocket implements RealtimeSocket {
  readonly send = vi.fn<(data: string) => void>()
  readonly close = vi.fn<(code?: number, reason?: string) => void>()
  onopen: (() => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onclose: ((event: { readonly code: number }) => void) | null = null

  open(): void {
    this.onopen?.()
  }

  message(data: unknown): void {
    this.onmessage?.({ data })
  }

  serverClose(code = 1006): void {
    this.onclose?.({ code })
  }
}

interface PrincipalState {
  readonly user: unknown | null
  readonly client: unknown | null
}

const ANONYMOUS: PrincipalState = { user: null, client: null }
const USER_PRINCIPAL: PrincipalState = { user: AUTH_BODY.user, client: null }
const CLIENT_PRINCIPAL: PrincipalState = { user: null, client: { id: 7, name: "ops-key" } }

function createFakeAuth(initial: PrincipalState) {
  let session = initial
  const listeners = new Set<() => void>()
  return {
    getSession: () => session,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: PrincipalState): void {
      session = next
      for (const listener of [...listeners]) listener()
    },
  }
}

class FakeRuntime {
  readonly clock = new TestClock()
  readonly sockets: FakeSocket[] = []
  readonly created: { url: string; protocols: readonly string[] }[] = []
  readonly statuses: RealtimeStatus[] = []
  readonly frames: RealtimeFrame[] = []
  readonly refresh = vi.fn(async () => ({}))
  readonly onAuthExpired = vi.fn()
  readonly auth = createFakeAuth(ANONYMOUS)

  constructor(initial: PrincipalState) {
    this.auth.set(initial)
  }

  readonly createSocket = (url: string, protocols: readonly string[]): RealtimeSocket => {
    const socket = new FakeSocket()
    this.sockets.push(socket)
    this.created.push({ url, protocols: [...protocols] })
    return socket
  }

  readonly setStatus = (status: RealtimeStatus): void => {
    this.statuses.push(status)
  }

  readonly publishFrame = (frame: RealtimeFrame): void => {
    this.frames.push(frame)
  }

  delaysWithoutSilence(): number[] {
    return this.clock.delays.filter((delay) => delay !== SILENCE_MS)
  }
}

/** Injects the fakes for every seam; URL getters keep their env-derived default. */
function createManager(
  runtime: FakeRuntime,
  options: Partial<RealtimeManagerOptions> = {},
): RealtimeManager {
  return new RealtimeManager({
    createSocket: runtime.createSocket,
    getSession: runtime.auth.getSession,
    subscribeAuth: runtime.auth.subscribe,
    refresh: runtime.refresh,
    onAuthExpired: runtime.onAuthExpired,
    publishFrame: runtime.publishFrame,
    setStatus: runtime.setStatus,
    setTimeoutFn: runtime.clock.setTimeout,
    clearTimeoutFn: runtime.clock.clearTimeout,
    getEventsUrl: () => EVENTS_URL,
    getNotificationsUrl: () => NOTIFICATIONS_URL,
    ...options,
  })
}

/** Fails the current socket 12 times: the spec's ceiling, no more reconnects. */
function driveToOffline(runtime: FakeRuntime): void {
  runtime.sockets[0]?.serverClose(1006)
  for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
    runtime.clock.advance(30_000)
    runtime.sockets.at(-1)?.serverClose(1006)
  }
}

afterEach(() => {
  clearAuthSession()
  resetRealtimeStatus()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------

describe("connection gate (first successful /auth/me)", () => {
  it("opens nothing while anonymous, then connects events first once a principal lands", () => {
    const runtime = new FakeRuntime(ANONYMOUS)
    const manager = createManager(runtime)

    manager.start()
    runtime.clock.advance(60_000)
    expect(runtime.created).toEqual([])
    expect(runtime.statuses.at(-1)).toBe("offline")

    runtime.auth.set(USER_PRINCIPAL)
    expect(runtime.created.map((entry) => entry.url)).toEqual([EVENTS_URL, NOTIFICATIONS_URL])
    expect(runtime.created[0]?.protocols).toEqual([])

    manager.stop()
  })

  it("skips the notifications socket entirely for an API-client principal (spec L164, §13.10.3)", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()

    expect(runtime.created.map((entry) => entry.url)).toEqual([EVENTS_URL])

    manager.stop()
  })

  it("offers the wrapper access JWT as the WebSocket subprotocol when configured (spec L167)", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime, { getSubprotocol: () => "jwt-token" })

    manager.start()

    expect(runtime.created.map((entry) => entry.protocols)).toEqual([["jwt-token"], ["jwt-token"]])

    manager.stop()
  })
})

describe("reconnect backoff", () => {
  it("walks 1→2→4→8→16→30s (cap), stops at 12 attempts and stops reconnecting", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    expect(runtime.sockets).toHaveLength(1)

    runtime.sockets[0]?.serverClose(1006)
    expect(runtime.statuses.at(-1)).toBe("reconnecting")

    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      runtime.clock.advance(30_000)
      expect(runtime.sockets).toHaveLength(attempt + 2)
      runtime.sockets.at(-1)?.serverClose(1006)
    }

    expect(runtime.delaysWithoutSilence()).toEqual([
      ...RECONNECT_BACKOFF_MS,
      ...new Array<number>(MAX_RECONNECT_ATTEMPTS - RECONNECT_BACKOFF_MS.length).fill(
        RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1],
      ),
    ])
    expect(runtime.statuses.at(-1)).toBe("offline")

    runtime.clock.advance(600_000)
    expect(runtime.sockets).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1)

    manager.stop()
  })

  it("retries a 1013 'server restarting' close on the backoff schedule (§13.9.6)", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.serverClose(1013)
    runtime.clock.advance(1_000)
    expect(runtime.sockets).toHaveLength(2)

    runtime.sockets[1]?.serverClose(1013)
    runtime.clock.advance(2_000)
    expect(runtime.sockets).toHaveLength(3)
    expect(runtime.delaysWithoutSilence()).toEqual([1_000, 2_000])
    expect(runtime.statuses.at(-1)).toBe("reconnecting")

    manager.stop()
  })

  it("resets the backoff after a successful open", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.serverClose(1006)
    runtime.clock.advance(1_000)

    const reopened = runtime.sockets[1]
    reopened?.open()
    expect(runtime.statuses.at(-1)).toBe("live")
    reopened?.serverClose(1006)

    expect(runtime.delaysWithoutSilence()).toEqual([1_000, 1_000])

    manager.stop()
  })

  it("manual retry leaves offline with a reset attempt counter (spec L171)", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    driveToOffline(runtime)
    expect(runtime.statuses.at(-1)).toBe("offline")
    const socketsBefore = runtime.sockets.length

    manager.retryNow()
    expect(runtime.sockets).toHaveLength(socketsBefore + 1)
    expect(runtime.statuses.at(-1)).toBe("reconnecting")

    runtime.sockets.at(-1)?.serverClose(1006)
    expect(runtime.delaysWithoutSilence().at(-1)).toBe(1_000)

    manager.stop()
  })
})

describe("close 4001 (auth)", () => {
  it("runs the refresh-once flow and reconnects with the new credentials", async () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    expect(runtime.sockets).toHaveLength(2)

    runtime.sockets[0]?.serverClose(4001)
    await vi.waitFor(() => expect(runtime.sockets).toHaveLength(3))

    expect(runtime.refresh).toHaveBeenCalledTimes(1)
    expect(runtime.onAuthExpired).not.toHaveBeenCalled()
    expect(runtime.created[2]?.url).toBe(EVENTS_URL)

    manager.stop()
  })

  it("logs out on a second 4001 without refreshing again", async () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.serverClose(4001)
    await vi.waitFor(() => expect(runtime.sockets).toHaveLength(3))

    runtime.sockets[2]?.serverClose(4001)
    await vi.waitFor(() => expect(runtime.onAuthExpired).toHaveBeenCalledTimes(1))

    expect(runtime.refresh).toHaveBeenCalledTimes(1)
    expect(runtime.sockets).toHaveLength(3)
    expect(runtime.delaysWithoutSilence()).toEqual([])

    manager.stop()
  })

  it("logs out when the refresh itself fails", async () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime, {
      refresh: () => Promise.reject(new Error("refresh failed")),
    })

    manager.start()
    runtime.sockets[0]?.serverClose(4001)

    await vi.waitFor(() => expect(runtime.onAuthExpired).toHaveBeenCalledTimes(1))
    expect(runtime.sockets).toHaveLength(2)
    expect(runtime.delaysWithoutSilence()).toEqual([])

    manager.stop()
  })

  it("shares one refresh across simultaneous 4001 closes", async () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.serverClose(4001)
    runtime.sockets[1]?.serverClose(4001)
    await vi.waitFor(() => expect(runtime.sockets).toHaveLength(4))

    expect(runtime.refresh).toHaveBeenCalledTimes(1)
    expect(runtime.onAuthExpired).not.toHaveBeenCalled()

    manager.stop()
  })
})

describe("server-silence watch", () => {
  it("recycles sockets silent past the spec threshold and reconnects", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    const events = runtime.sockets[0]
    const notifications = runtime.sockets[1]
    events?.open()
    notifications?.open()
    expect(runtime.statuses.at(-1)).toBe("live")

    runtime.clock.advance(SILENCE_MS)
    expect(events?.close).toHaveBeenCalledTimes(1)
    expect(notifications?.close).toHaveBeenCalledTimes(1)

    runtime.clock.advance(1_000)
    expect(runtime.sockets).toHaveLength(4)
    expect(runtime.delaysWithoutSilence()).toEqual([1_000, 1_000])

    manager.stop()
  })

  it("resets the silence timer on every received frame", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    const events = runtime.sockets[0]
    runtime.sockets[1]?.open()
    events?.open()

    runtime.clock.advance(SILENCE_MS - 5_000)
    events?.message('{"type":"event","event":"session.updated","id":5}')
    runtime.clock.advance(10_000)
    expect(events?.close).not.toHaveBeenCalled()

    runtime.clock.advance(35_000)
    expect(events?.close).toHaveBeenCalledTimes(1)

    manager.stop()
  })
})

describe("connection state and shutdown", () => {
  it("drives the dot seam live → reconnecting → offline", () => {
    const runtime = new FakeRuntime(CLIENT_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    expect(runtime.statuses.at(-1)).toBe("reconnecting")

    runtime.sockets[0]?.open()
    expect(runtime.statuses.at(-1)).toBe("live")

    runtime.sockets[0]?.serverClose(1006)
    expect(runtime.statuses.at(-1)).toBe("reconnecting")

    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      runtime.clock.advance(30_000)
      runtime.sockets.at(-1)?.serverClose(1006)
    }
    expect(runtime.statuses.at(-1)).toBe("offline")

    manager.stop()
  })

  it("closes both sockets on logout and never reconnects them", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.open()
    runtime.sockets[1]?.open()
    expect(runtime.statuses.at(-1)).toBe("live")

    runtime.auth.set(ANONYMOUS)

    expect(runtime.sockets[0]?.close).toHaveBeenCalledTimes(1)
    expect(runtime.sockets[1]?.close).toHaveBeenCalledTimes(1)
    expect(runtime.statuses.at(-1)).toBe("offline")

    runtime.clock.advance(600_000)
    expect(runtime.sockets).toHaveLength(2)

    manager.stop()
  })

  it("stops without a lingering auth subscription", () => {
    const runtime = new FakeRuntime(ANONYMOUS)
    const manager = createManager(runtime)

    manager.start()
    manager.stop()
    runtime.auth.set(USER_PRINCIPAL)

    expect(runtime.created).toEqual([])
  })
})

describe("sockets never send frames (§11.1 server-push only)", () => {
  it("never calls send, on any socket, through open/message/close cycles", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = createManager(runtime)

    manager.start()
    runtime.sockets[0]?.open()
    runtime.sockets[1]?.open()
    runtime.sockets[0]?.message('{"type":"event","event":"session.updated","id":5}')
    runtime.sockets[1]?.message('{"type":"notification","data":{"title":"x"}}')
    runtime.sockets[0]?.serverClose(1006)
    runtime.clock.advance(1_000)
    runtime.sockets.at(-1)?.open()

    expect(runtime.sockets.length).toBeGreaterThan(0)
    for (const socket of runtime.sockets) {
      expect(socket.send).not.toHaveBeenCalled()
    }

    manager.stop()
  })
})

describe("frame seam for todo 19", () => {
  it("publishes raw parsed frames tagged by role and ignores non-JSON payloads", () => {
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const received: RealtimeFrame[] = []
    const unsubscribe = subscribeRealtimeFrames((frame) => received.push(frame))
    const manager = new RealtimeManager({
      createSocket: runtime.createSocket,
      getSession: runtime.auth.getSession,
      subscribeAuth: runtime.auth.subscribe,
      setStatus: runtime.setStatus,
      setTimeoutFn: runtime.clock.setTimeout,
      clearTimeoutFn: runtime.clock.clearTimeout,
      getEventsUrl: () => EVENTS_URL,
      getNotificationsUrl: () => NOTIFICATIONS_URL,
    })

    manager.start()
    runtime.sockets[0]?.message('{"type":"event","event":"session.updated","id":5}')
    runtime.sockets[1]?.message('{"type":"notification","data":{"title":"x"}}')
    runtime.sockets[0]?.message("not json")

    expect(received).toEqual([
      { role: "events", payload: { type: "event", event: "session.updated", id: 5 } },
      { role: "notifications", payload: { type: "notification", data: { title: "x" } } },
    ])

    unsubscribe()
    manager.stop()
  })
})

describe("derived socket URLs (env.ts is the single derivation site)", () => {
  it("resolves a relative VITE_API_URL to ws://<page-origin>/ws/events, never /api/ws/", () => {
    vi.stubEnv(API_URL_ENV_VAR, "/api")
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = new RealtimeManager({
      createSocket: runtime.createSocket,
      getSession: runtime.auth.getSession,
      subscribeAuth: runtime.auth.subscribe,
      setStatus: runtime.setStatus,
      setTimeoutFn: runtime.clock.setTimeout,
      clearTimeoutFn: runtime.clock.clearTimeout,
    })

    manager.start()

    expect(runtime.created[0]?.url).toBe(`ws://${window.location.host}/ws/events`)
    expect(runtime.created[1]?.url).toBe(`ws://${window.location.host}/ws/notifications`)
    expect(runtime.created[0]?.url).not.toContain("/api/ws/")

    manager.stop()
  })

  it("maps an absolute https base to wss://<origin>/ws/events with the base path dropped", () => {
    vi.stubEnv(API_URL_ENV_VAR, "https://mirrorr.example.org/base")
    const runtime = new FakeRuntime(USER_PRINCIPAL)
    const manager = new RealtimeManager({
      createSocket: runtime.createSocket,
      getSession: runtime.auth.getSession,
      subscribeAuth: runtime.auth.subscribe,
      setStatus: runtime.setStatus,
      setTimeoutFn: runtime.clock.setTimeout,
      clearTimeoutFn: runtime.clock.clearTimeout,
    })

    manager.start()

    expect(runtime.created[0]?.url).toBe("wss://mirrorr.example.org/ws/events")
    expect(runtime.created[1]?.url).toBe("wss://mirrorr.example.org/ws/notifications")
    expect(runtime.created[0]?.url).not.toContain("/base/ws/")

    manager.stop()
  })
})

describe("auth-store wiring", () => {
  it("connects only after a real session exists and shuts down through clearAuthSession()", () => {
    vi.stubEnv(API_URL_ENV_VAR, "/api")
    const runtime = new FakeRuntime(ANONYMOUS)
    const manager = new RealtimeManager({
      createSocket: runtime.createSocket,
      publishFrame: runtime.publishFrame,
      setStatus: runtime.setStatus,
      setTimeoutFn: runtime.clock.setTimeout,
      clearTimeoutFn: runtime.clock.clearTimeout,
    })

    manager.start()
    expect(runtime.created).toEqual([])

    setAuthSession(AUTH_BODY)
    expect(runtime.created.map((entry) => entry.url)).toEqual([
      `ws://${window.location.host}/ws/events`,
      `ws://${window.location.host}/ws/notifications`,
    ])

    clearAuthSession()
    expect(runtime.sockets[0]?.close).toHaveBeenCalledTimes(1)
    expect(runtime.sockets[1]?.close).toHaveBeenCalledTimes(1)
    runtime.clock.advance(600_000)
    expect(runtime.sockets).toHaveLength(2)

    manager.stop()
  })
})
