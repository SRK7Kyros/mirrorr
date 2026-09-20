/**
 * The realtime socket manager: ONE singleton owning both WebSockets.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L162-L171 — both sockets open after the first
 *   successful `GET /auth/me` and close on logout; `/ws/events` is the entity
 *   stream and `/ws/notifications` is skipped entirely when `user` is null
 *   (API-client principals); auth rides the httpOnly cookie on web and the
 *   `Sec-WebSocket-Protocol` subprotocol in the Capacitor wrapper; the client
 *   never sends frames (`heartbeat is server-driven — client only watches for
 *   silence`); reconnect is 1→2→4→8→16→30s capped, max 12 attempts; close
 *   `4001` runs refresh-once → reconnect (second `4001` → logout), `1013`
 *   retries with backoff; after 12 failed attempts the dot is red and the
 *   "Live updates offline — polling every 15s" banner shows.
 * - `docs/web-frontend-spec.md` L589 — socket URLs are DERIVED from
 *   `VITE_API_URL` by `src/config/env.ts`; this module never re-derives them.
 * - `docs/general-client-specification.md` §11.1-§11.2 (server-push only) and
 *   §13.9.6 (`4001` = auth, `1013` = temporarily unavailable, anything else =
 *   capped backoff).
 *
 * Boundaries owned by later todos: the manager only parses JSON and exposes
 * the raw frame stream (`subscribeRealtimeFrames`). The subject→reaction table,
 * coalescing and remux progress are todo 19; the notification badge/toast
 * pipeline is todo 20; polling cadences are todo 21.
 */
import { getWsEventsUrl, getWsNotificationsUrl } from "@/config/env"
import { refreshSession } from "@/lib/api"
import { expireSession, getAuthState, subscribeToAuth } from "@/lib/auth-store"
import {
  DEFAULT_REALTIME_STATUS,
  setRealtimeStatus,
  type RealtimeStatus,
} from "@/lib/realtime-status"

/** Spec L171: exponential backoff 1s→2s→4s→8s→16s→30s (cap). */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const

/** Spec L171: max 12 reconnection attempts before the red/polling state. */
export const MAX_RECONNECT_ATTEMPTS = 12

/** Spec L169: any socket silent >45s is force-closed and reconnected. */
export const SOCKET_SILENCE_TIMEOUT_MS = 45_000

/** §13.9.6: auth close code; the server refuses unauthenticated sockets with it. */
export const AUTH_CLOSE_CODE = 4001

export type RealtimeSocketRole = "events" | "notifications"

/** The minimal WebSocket surface the manager drives (fake-able in tests). */
export interface RealtimeSocket {
  readonly send: (data: string) => void
  readonly close: (code?: number, reason?: string) => void
  onopen: ((event: Event) => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onclose: ((event: { readonly code: number }) => void) | null
}

/** One raw parsed frame, tagged with the socket it arrived on (todo 19/20 seam). */
export interface RealtimeFrame {
  readonly role: RealtimeSocketRole
  readonly payload: unknown
}

/** The principal shape the gate reads (structurally `AuthState`). */
export interface RealtimePrincipalState {
  readonly user: unknown | null
  readonly client: unknown | null
}

export interface RealtimeManagerOptions {
  readonly createSocket?: (url: string, protocols: readonly string[]) => RealtimeSocket
  readonly getEventsUrl?: () => string
  readonly getNotificationsUrl?: () => string
  readonly getSession?: () => RealtimePrincipalState
  readonly subscribeAuth?: (listener: () => void) => () => void
  /** Wrapper builds return the access JWT here (spec L167); web returns null. */
  readonly getSubprotocol?: () => string | null
  readonly refresh?: () => Promise<unknown>
  readonly onAuthExpired?: () => void
  readonly publishFrame?: (frame: RealtimeFrame) => void
  readonly setStatus?: (status: RealtimeStatus) => void
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => number
  readonly clearTimeoutFn?: (handle: number) => void
  readonly silenceTimeoutMs?: number
  readonly backoffScheduleMs?: readonly number[]
  readonly maxAttempts?: number
}

type SlotState = "idle" | "connecting" | "open" | "waiting" | "offline"
type AuthRefreshState = "available" | "done" | "failed"

interface SocketSlot {
  socket: RealtimeSocket | null
  state: SlotState
  attempts: number
  retryTimer: number | null
  silenceTimer: number | null
}

interface ResolvedOptions {
  readonly createSocket: (url: string, protocols: readonly string[]) => RealtimeSocket
  readonly getEventsUrl: () => string
  readonly getNotificationsUrl: () => string
  readonly getSession: () => RealtimePrincipalState
  readonly subscribeAuth: (listener: () => void) => () => void
  readonly getSubprotocol: () => string | null
  readonly refresh: () => Promise<unknown>
  readonly onAuthExpired: () => void
  readonly publishFrame: (frame: RealtimeFrame) => void
  readonly setStatus: (status: RealtimeStatus) => void
  readonly setTimeoutFn: (callback: () => void, delayMs: number) => number
  readonly clearTimeoutFn: (handle: number) => void
  readonly silenceTimeoutMs: number
  readonly backoffScheduleMs: readonly number[]
  readonly maxAttempts: number
}

const SOCKET_ROLES: readonly RealtimeSocketRole[] = ["events", "notifications"]

function createEmptySlot(): SocketSlot {
  return { socket: null, state: "idle", attempts: 0, retryTimer: null, silenceTimer: null }
}

function defaultCreateSocket(url: string, protocols: readonly string[]): RealtimeSocket {
  const socket = protocols.length === 0 ? new WebSocket(url) : new WebSocket(url, [...protocols])
  const handle: RealtimeSocket = {
    send: (data) => {
      socket.send(data)
    },
    close: (code, reason) => {
      socket.close(code, reason)
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  }
  socket.onopen = (event) => {
    handle.onopen?.(event)
  }
  socket.onmessage = (event) => {
    handle.onmessage?.(event)
  }
  socket.onclose = (event) => {
    handle.onclose?.(event)
  }
  return handle
}

function parseFramePayload(data: unknown): unknown {
  if (typeof data !== "string") return undefined
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

export class RealtimeManager {
  private readonly options: ResolvedOptions
  private started = false
  private unsubscribeAuth: (() => void) | null = null
  private authRefreshState: AuthRefreshState = "available"
  private authRefreshInFlight: Promise<void> | null = null
  private readonly slots: Record<RealtimeSocketRole, SocketSlot> = {
    events: createEmptySlot(),
    notifications: createEmptySlot(),
  }

  constructor(options: RealtimeManagerOptions = {}) {
    this.options = {
      createSocket: options.createSocket ?? defaultCreateSocket,
      getEventsUrl: options.getEventsUrl ?? (() => getWsEventsUrl()),
      getNotificationsUrl: options.getNotificationsUrl ?? (() => getWsNotificationsUrl()),
      getSession: options.getSession ?? (() => getAuthState()),
      subscribeAuth: options.subscribeAuth ?? ((listener) => subscribeToAuth(listener)),
      getSubprotocol: options.getSubprotocol ?? (() => null),
      refresh: options.refresh ?? (() => refreshSession()),
      onAuthExpired: options.onAuthExpired ?? (() => expireSession()),
      publishFrame: options.publishFrame ?? ((frame) => publishRealtimeFrame(frame)),
      setStatus: options.setStatus ?? ((status) => setRealtimeStatus(status)),
      setTimeoutFn:
        options.setTimeoutFn ??
        ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
      clearTimeoutFn: options.clearTimeoutFn ?? ((handle) => globalThis.clearTimeout(handle)),
      silenceTimeoutMs: options.silenceTimeoutMs ?? SOCKET_SILENCE_TIMEOUT_MS,
      backoffScheduleMs: options.backoffScheduleMs ?? RECONNECT_BACKOFF_MS,
      maxAttempts: options.maxAttempts ?? MAX_RECONNECT_ATTEMPTS,
    }
  }

  /**
   * Starts watching the auth store. Sockets connect only once a principal
   * exists — i.e. after the first successful `GET /auth/me` (or a login) has
   * populated `auth-store`; an anonymous boot opens nothing.
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.unsubscribeAuth = this.options.subscribeAuth(() => {
      this.syncFromAuth()
    })
    this.syncFromAuth()
  }

  /** Logout/teardown: closes both sockets, cancels timers, never reconnects. */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
    this.authRefreshState = "available"
    this.authRefreshInFlight = null
    for (const role of SOCKET_ROLES) this.shutdownSocket(role)
    this.options.setStatus(DEFAULT_REALTIME_STATUS)
  }

  /** The banner's Retry (spec L171): resume every active socket immediately. */
  retryNow(): void {
    if (!this.started) return
    for (const role of this.activeRoles()) this.reconnectNow(role)
  }

  // -------------------------------------------------------------------------
  // Principal gate
  // -------------------------------------------------------------------------

  private activeRoles(session: RealtimePrincipalState = this.options.getSession()): RealtimeSocketRole[] {
    if (session.user === null && session.client === null) return []
    // Spec L164: the notifications surface 401s for API clients — never open it.
    return session.user === null ? ["events"] : ["events", "notifications"]
  }

  private syncFromAuth(): void {
    const session = this.options.getSession()
    if (session.user === null && session.client === null) {
      for (const role of SOCKET_ROLES) this.shutdownSocket(role)
      this.authRefreshState = "available"
      this.options.setStatus(DEFAULT_REALTIME_STATUS)
      return
    }

    const roles = this.activeRoles(session)
    for (const role of SOCKET_ROLES) {
      if (!roles.includes(role)) this.shutdownSocket(role)
    }
    for (const role of roles) {
      if (this.slots[role].state === "idle") this.connect(role)
    }
    this.updateStatus()
  }

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------

  private connect(role: RealtimeSocketRole): void {
    if (!this.started) return
    const session = this.options.getSession()
    if (session.user === null && session.client === null) return
    if (role === "notifications" && session.user === null) return

    const slot = this.slots[role]
    if (slot.state !== "idle") return

    const url = role === "events" ? this.options.getEventsUrl() : this.options.getNotificationsUrl()
    const protocol = this.options.getSubprotocol()
    const socket = this.options.createSocket(url, protocol === null ? [] : [protocol])

    slot.socket = socket
    slot.state = "connecting"
    socket.onopen = () => {
      this.handleOpen(role, socket)
    }
    socket.onmessage = (event) => {
      this.handleMessage(role, socket, event.data)
    }
    socket.onclose = (event) => {
      this.handleClose(role, socket, event.code)
    }
    this.updateStatus()
  }

  private handleOpen(role: RealtimeSocketRole, socket: RealtimeSocket): void {
    const slot = this.slots[role]
    if (slot.socket !== socket) return
    slot.state = "open"
    slot.attempts = 0
    this.startSilenceTimer(role)
    this.updateStatus()
  }

  private handleMessage(role: RealtimeSocketRole, socket: RealtimeSocket, data: unknown): void {
    if (this.slots[role].socket !== socket) return
    this.resetSilenceTimer(role)

    const payload = parseFramePayload(data)
    if (payload === undefined) return
    this.options.publishFrame({ role, payload })
  }

  private handleClose(role: RealtimeSocketRole, socket: RealtimeSocket, code: number): void {
    const slot = this.slots[role]
    if (slot.socket !== socket) return

    slot.socket = null
    slot.state = "idle"
    this.clearSilenceTimer(slot)
    this.updateStatus()

    if (!this.started) return
    const session = this.options.getSession()
    if (session.user === null && session.client === null) return

    if (code === AUTH_CLOSE_CODE) {
      this.handleUnauthorized(role)
      return
    }
    this.scheduleRetry(role)
  }

  // -------------------------------------------------------------------------
  // Close-code handling
  // -------------------------------------------------------------------------

  /**
   * Spec L167: `4001` → refresh-once → reconnect; a second `4001` after that
   * refresh → logout. Simultaneous close codes share ONE in-flight refresh, so
   * JTI rotation can never race (spec L156).
   */
  private handleUnauthorized(role: RealtimeSocketRole): void {
    if (this.authRefreshState !== "available") {
      this.options.onAuthExpired()
      return
    }

    const refresh = this.authRefreshInFlight ?? this.beginAuthRefresh()
    void refresh.then(
      () => {
        this.reconnectNow(role)
      },
      () => {
        // `beginAuthRefresh` already emitted the logout consequence.
      },
    )
  }

  private beginAuthRefresh(): Promise<void> {
    const refresh = this.options
      .refresh()
      .then(
        () => {
          this.authRefreshState = "done"
        },
        (error: unknown) => {
          this.authRefreshState = "failed"
          this.options.onAuthExpired()
          throw error
        },
      )
      .finally(() => {
        if (this.authRefreshInFlight === refresh) this.authRefreshInFlight = null
      })
    this.authRefreshInFlight = refresh
    return refresh
  }

  private reconnectNow(role: RealtimeSocketRole): void {
    if (!this.started) return
    const slot = this.slots[role]
    if (slot.state === "open" || slot.state === "connecting") return
    if (slot.retryTimer !== null) {
      this.options.clearTimeoutFn(slot.retryTimer)
      slot.retryTimer = null
    }
    slot.attempts = 0
    slot.state = "idle"
    this.connect(role)
  }

  /** Spec L171 + §13.9.6: capped backoff, max 12 attempts, then offline. */
  private scheduleRetry(role: RealtimeSocketRole): void {
    if (!this.started) return
    const slot = this.slots[role]

    if (slot.attempts >= this.options.maxAttempts) {
      slot.state = "offline"
      this.updateStatus()
      return
    }

    const schedule = this.options.backoffScheduleMs
    const delay =
      schedule.length === 0 ? RECONNECT_BACKOFF_MS[0] : schedule[Math.min(slot.attempts, schedule.length - 1)]
    slot.attempts += 1
    slot.state = "waiting"
    slot.retryTimer = this.options.setTimeoutFn(() => {
      slot.retryTimer = null
      slot.state = "idle"
      this.connect(role)
    }, delay)
    this.updateStatus()
  }

  // -------------------------------------------------------------------------
  // Server-silence watch (client never pings)
  // -------------------------------------------------------------------------

  private startSilenceTimer(role: RealtimeSocketRole): void {
    const slot = this.slots[role]
    this.clearSilenceTimer(slot)
    slot.silenceTimer = this.options.setTimeoutFn(() => {
      this.recycleSocket(role)
    }, this.options.silenceTimeoutMs)
  }

  private resetSilenceTimer(role: RealtimeSocketRole): void {
    if (this.slots[role].state !== "open") return
    this.startSilenceTimer(role)
  }

  private clearSilenceTimer(slot: SocketSlot): void {
    if (slot.silenceTimer === null) return
    this.options.clearTimeoutFn(slot.silenceTimer)
    slot.silenceTimer = null
  }

  private recycleSocket(role: RealtimeSocketRole): void {
    const slot = this.slots[role]
    if (slot.state !== "open") return
    const socket = slot.socket
    slot.socket = null
    slot.state = "idle"
    this.clearSilenceTimer(slot)
    socket?.close(1000, "silence recycle")
    this.scheduleRetry(role)
  }

  private shutdownSocket(role: RealtimeSocketRole): void {
    const slot = this.slots[role]
    if (slot.retryTimer !== null) {
      this.options.clearTimeoutFn(slot.retryTimer)
      slot.retryTimer = null
    }
    this.clearSilenceTimer(slot)
    const socket = slot.socket
    slot.socket = null
    slot.state = "idle"
    slot.attempts = 0
    socket?.close()
  }

  // -------------------------------------------------------------------------
  // Dot seam
  // -------------------------------------------------------------------------

  private updateStatus(): void {
    if (!this.started) {
      this.options.setStatus(DEFAULT_REALTIME_STATUS)
      return
    }
    const roles = this.activeRoles()
    if (roles.length === 0) {
      this.options.setStatus(DEFAULT_REALTIME_STATUS)
      return
    }
    if (roles.some((role) => this.slots[role].state === "offline")) {
      this.options.setStatus("offline")
      return
    }
    if (roles.every((role) => this.slots[role].state === "open")) {
      this.options.setStatus("live")
      return
    }
    this.options.setStatus("reconnecting")
  }
}

// ---------------------------------------------------------------------------
// Module-level frame bus + app singleton
// ---------------------------------------------------------------------------

const frameListeners = new Set<(frame: RealtimeFrame) => void>()

function publishRealtimeFrame(frame: RealtimeFrame): void {
  for (const listener of [...frameListeners]) listener(frame)
}

/**
 * The todo-19/20 seam: every parsed `/ws/events` and `/ws/notifications` frame
 * arrives here tagged with its role. This module deliberately stops at parsing.
 */
export function subscribeRealtimeFrames(listener: (frame: RealtimeFrame) => void): () => void {
  frameListeners.add(listener)
  return () => {
    frameListeners.delete(listener)
  }
}

let singleton: RealtimeManager | null = null

export function getRealtimeManager(): RealtimeManager {
  singleton ??= new RealtimeManager()
  return singleton
}

/** Boot wiring (`main.tsx`): start watching the auth store. */
export function startRealtimeManager(): RealtimeManager {
  const manager = getRealtimeManager()
  manager.start()
  return manager
}

export function stopRealtimeManager(): void {
  singleton?.stop()
}

/** The health banner's manual Retry (spec L171); no-op before the manager exists. */
export function retryRealtimeNow(): void {
  singleton?.retryNow()
}
