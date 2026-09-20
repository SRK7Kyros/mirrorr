/**
 * Spec L169 (Mobile lifecycle), web half: the wrapper reports app state
 * through Capacitor's `appStateChange` (todo 29 attaches that listener); in a
 * browser the same transitions arrive as `visibilitychange`, so this module
 * owns the policy and takes the event source as a seam.
 *
 * Policy: on background the sockets stay open for a 30s grace window, then
 * close deliberately. On resume — if the grace elapsed — the sockets reconnect
 * at once with a fresh attempt budget (the manager owns the >45s silence
 * recycle), and every visible query refetches once: the polling backstop is the
 * source of truth, not the socket. A frame that lands while backgrounded still
 * counts toward the badge but raises no toast, and nothing is queued, so no
 * stale alert replays on resume.
 */
import { pauseRealtimeNow, resumeRealtimeNow } from "@/lib/realtime-manager"

/** Spec L169: sockets stay open this long after backgrounding, then close. */
export const BACKGROUND_GRACE_MS = 30_000

export interface AppLifecycleOptions {
  /** Overridable for tests; defaults to the document's visibility events. */
  readonly subscribeVisibility?: (listener: (hidden: boolean) => void) => () => void
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, delayMs: number) => number
  readonly clearTimer?: (handle: number) => void
  readonly pause?: () => void
  readonly resume?: () => void
  /** Refetch every visible query once, after a resume. */
  readonly refetchVisible?: () => void
  readonly graceMs?: number
}

// The backgrounded flag is process-wide: the toast policy reads it for frames
// that arrive while the app is hidden (spec L169, L573).
let backgrounded = false
const backgroundListeners = new Set<() => void>()

export function isAppBackgrounded(): boolean {
  return backgrounded
}

export function subscribeAppBackground(listener: () => void): () => void {
  backgroundListeners.add(listener)
  return () => {
    backgroundListeners.delete(listener)
  }
}

function setBackgrounded(next: boolean): void {
  if (backgrounded === next) return
  backgrounded = next
  for (const listener of [...backgroundListeners]) listener()
}

function defaultSubscribeVisibility(listener: (hidden: boolean) => void): () => void {
  const handler = (): void => listener(document.visibilityState === "hidden")
  document.addEventListener("visibilitychange", handler)
  listener(document.visibilityState === "hidden")
  return () => document.removeEventListener("visibilitychange", handler)
}

export function installAppLifecycle(options: AppLifecycleOptions = {}): () => void {
  const subscribeVisibility = options.subscribeVisibility ?? defaultSubscribeVisibility
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle))
  const pause = options.pause ?? pauseRealtimeNow
  const resume = options.resume ?? resumeRealtimeNow
  const refetchVisible = options.refetchVisible ?? (() => undefined)
  const graceMs = options.graceMs ?? BACKGROUND_GRACE_MS

  let hiddenAt: number | null = null
  let paused = false
  let timer: number | null = null

  const cancelTimer = (): void => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const unsubscribe = subscribeVisibility((hidden) => {
    setBackgrounded(hidden)

    if (hidden) {
      hiddenAt = now()
      cancelTimer()
      timer = setTimer(() => {
        timer = null
        paused = true
        pause()
      }, graceMs)
      return
    }

    cancelTimer()
    if (hiddenAt === null) return
    const backgroundedMs = now() - hiddenAt
    hiddenAt = null
    if (paused || backgroundedMs > graceMs) {
      paused = false
      resume()
    }
    refetchVisible()
  })

  return () => {
    cancelTimer()
    unsubscribe()
    setBackgrounded(false)
    hiddenAt = null
    paused = false
  }
}
