import { apiBase, refreshSession } from "@/api/client"

export type RealtimeSocketState =
  | "closed"
  | "connecting"
  | "open"
  | "reconnecting"
  | "polling"
  | "skipped"

export interface RealtimeState {
  readonly events: RealtimeSocketState
  readonly notifications: RealtimeSocketState
  readonly attempts: number
  readonly pollingFallback: boolean
}

export interface WebSocketLike {
  onopen: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  close: () => void
}

export type WebSocketConstructor = new (url: string) => WebSocketLike

export interface RealtimeFrameHandlers {
  readonly onEvent?: (frame: unknown) => void
  readonly onNotification?: (frame: unknown) => void
}

export interface RealtimeManagerOptions {
  readonly webSocketImpl?: WebSocketConstructor
  readonly refresh?: () => Promise<void>
  readonly onAuthFailure?: () => void
}

const MAX_ATTEMPTS = 12
const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/** Reconnect ladder 1s → 2s → 4s → 8s → 16s → 30s cap. */
export function backoffDelay(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1))
}

/** `${base http→ws}/ws/...` — origin only (never the base path); credentials ride cookies, never query strings. */
export function wsEndpoint(path: string): string {
  const base = apiBase()
  if (base.startsWith("/")) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}${path}`
  }
  return `${base.replace(/^http/, "ws")}${path}`
}

type SocketKind = "events" | "notifications"

export class RealtimeManager {
  private readonly options: RealtimeManagerOptions
  private readonly listeners = new Set<() => void>()
  private readonly sockets: {
    events: WebSocketLike | null
    notifications: WebSocketLike | null
  } = { events: null, notifications: null }
  private state: RealtimeState = {
    events: "closed",
    notifications: "closed",
    attempts: 0,
    pollingFallback: false,
  }
  private handlers: RealtimeFrameHandlers = {}
  private running = false
  private wantNotifications = true
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: RealtimeManagerOptions = {}) {
    this.options = options
  }

  start(openNotifications = true): void {
    this.wantNotifications = openNotifications
    if (this.running) {
      this.syncNotificationsSocket()
      return
    }
    this.running = true
    this.attempts = 0
    this.state = { ...this.state, attempts: 0, pollingFallback: false }
    this.openAll()
    this.emit()
  }

  stop(): void {
    this.running = false
    this.clearTimer()
    this.closeSocket("events")
    this.closeSocket("notifications")
    this.attempts = 0
    this.state = {
      events: "closed",
      notifications: this.wantNotifications ? "closed" : "skipped",
      attempts: 0,
      pollingFallback: false,
    }
    this.emit()
  }

  /** Manual banner "Retry" and resume after a successful polling fetch. */
  retry(): void {
    if (!this.running) return
    this.clearTimer()
    this.attempts = 0
    this.state = { ...this.state, attempts: 0, pollingFallback: false }
    this.emit()
    this.openAll()
  }

  getState(): RealtimeState {
    return { ...this.state }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setFrameHandlers(handlers: RealtimeFrameHandlers): () => void {
    this.handlers = handlers
    return () => {
      if (this.handlers === handlers) this.handlers = {}
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private setSocketState(kind: SocketKind, socketState: RealtimeSocketState): void {
    if (kind === "events") this.state = { ...this.state, events: socketState }
    else this.state = { ...this.state, notifications: socketState }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private socketConstructor(): WebSocketConstructor | null {
    const globalImpl = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
    return this.options.webSocketImpl ?? globalImpl ?? null
  }

  private openAll(): void {
    this.openSocket("events")
    this.openSocket("notifications")
  }

  private syncNotificationsSocket(): void {
    if (!this.wantNotifications) {
      this.closeSocket("notifications")
      this.setSocketState("notifications", "skipped")
      this.emit()
      return
    }
    if (this.sockets.notifications === null && !this.state.pollingFallback) {
      this.openSocket("notifications")
      this.emit()
    }
  }

  private openSocket(kind: SocketKind): void {
    if (!this.running) return
    if (kind === "notifications" && !this.wantNotifications) {
      this.setSocketState(kind, "skipped")
      return
    }
    if (this.sockets[kind] !== null) return
    const Constructor = this.socketConstructor()
    if (Constructor === null) {
      console.warn("WebSocket unavailable — realtime stays offline")
      this.setSocketState(kind, "closed")
      this.emit()
      return
    }
    const degraded = this.attempts > 0 || this.state.pollingFallback
    this.setSocketState(kind, degraded ? "reconnecting" : "connecting")
    this.emit()
    const path = kind === "events" ? "/ws/events" : "/ws/notifications"
    let socket: WebSocketLike
    try {
      socket = new Constructor(wsEndpoint(path))
    } catch (error) {
      console.warn("WebSocket construction failed", error)
      this.handleClose(kind, 1006)
      return
    }
    this.sockets[kind] = socket
    socket.onopen = () => {
      if (this.sockets[kind] !== socket) return
      this.handleOpen(kind)
    }
    socket.onclose = (event) => {
      if (this.sockets[kind] !== socket) return
      this.sockets[kind] = null
      this.handleClose(kind, event.code)
    }
    socket.onmessage = (event) => {
      this.handleMessage(kind, event.data)
    }
  }

  private closeSocket(kind: SocketKind): void {
    const socket = this.sockets[kind]
    if (socket === null) return
    this.sockets[kind] = null
    socket.onopen = null
    socket.onclose = null
    socket.onmessage = null
    socket.close()
  }

  private handleOpen(kind: SocketKind): void {
    this.setSocketState(kind, "open")
    if (kind === "events") {
      this.attempts = 0
      this.state = { ...this.state, attempts: 0, pollingFallback: false }
    }
    this.emit()
  }

  private handleClose(kind: SocketKind, code: number): void {
    if (!this.running) return
    this.setSocketState(kind, "closed")
    if (code === 4001) {
      // Auth close: one refresh (api.ts single-flight), reconnect or logout.
      this.emit()
      void this.handleAuthClose()
      return
    }
    if (kind === "notifications" && this.sockets.events !== null) {
      // Primary stream healthy: notifications retry on plain backoff without
      // burning the shared 12-attempt failure budget.
      this.emit()
      this.scheduleReconnect()
      return
    }
    this.attempts += 1
    this.state = { ...this.state, attempts: this.attempts }
    if (this.attempts >= MAX_ATTEMPTS) {
      // 12 failed attempts → persistent banner flag + 15s polling fallback.
      this.state = {
        ...this.state,
        pollingFallback: true,
        events: "polling",
        notifications:
          this.sockets.notifications === null
            ? this.wantNotifications
              ? "closed"
              : "skipped"
            : "open",
      }
      this.clearTimer()
      this.emit()
      return
    }
    // Close 1013 (server restarting) and ordinary drops share the backoff.
    this.setSocketState(kind, "reconnecting")
    this.emit()
    this.scheduleReconnect()
  }

  private async handleAuthClose(): Promise<void> {
    const refresh = this.options.refresh ?? refreshSession
    try {
      await refresh()
    } catch {
      this.options.onAuthFailure?.() // refresh-once failed → auth seam logs out
      return
    }
    if (!this.running) return
    this.attempts = 0
    this.state = { ...this.state, attempts: 0, pollingFallback: false }
    this.emit()
    this.openAll()
  }

  private scheduleReconnect(): void {
    if (this.timer !== null) return
    const delay = backoffDelay(Math.max(1, this.attempts))
    this.timer = setTimeout(() => {
      this.timer = null
      this.openAll()
    }, delay)
  }

  private handleMessage(kind: SocketKind, data: unknown): void {
    if (typeof data !== "string") {
      console.warn("Mirrorr WS frame is not text", typeof data)
      return
    }
    let frame: unknown
    try {
      frame = JSON.parse(data)
    } catch (error) {
      console.warn("Mirrorr WS frame is not JSON", error)
      return
    }
    if (kind === "events") this.handlers.onEvent?.(frame)
    else this.handlers.onNotification?.(frame)
  }
}

const defaultManager = new RealtimeManager()

/** Open after the first successful `/auth/me`; `openNotifications: false` for API clients. */
export function startRealtimeManager(options?: { openNotifications?: boolean }): void {
  defaultManager.start(options?.openNotifications ?? true)
}

export function stopRealtimeManager(): void {
  defaultManager.stop()
}

export function subscribeRealtimeState(listener: () => void): () => void {
  return defaultManager.subscribe(listener)
}

export function getRealtimeState(): RealtimeState {
  return defaultManager.getState()
}

export function setRealtimeFrameHandlers(handlers: RealtimeFrameHandlers): () => void {
  return defaultManager.setFrameHandlers(handlers)
}

export function retryRealtime(): void {
  defaultManager.retry()
}

/** Views call this after a successful poll while the offline banner is up — resumes WS. */
export function notifyRealtimePollSuccess(): void {
  if (defaultManager.getState().pollingFallback) defaultManager.retry()
}
