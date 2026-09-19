/**
 * The remux-progress frame store.
 *
 * Contract:
 * - `docs/general-client-specification.md` §13.4 — while the RecordingManager
 *   remuxes, `session.{id}.remux.progress` carries
 *   `{session_id, percent, eta_seconds?, speed?, time?, frame?}` parsed from
 *   ffmpeg `-stats` (~every 5s).
 * - `docs/web-frontend-spec.md` L193 — the open detail subscribes for its id
 *   only; frames for a session that is not open are dropped; if `remuxing` and
 *   no frame arrives within 10s the view renders an indeterminate bar.
 *
 * The store is framework-free (the React binding lives in
 * `RemuxProgressCard`) so the Wave 3 socket can feed it without mounting a
 * component.
 */

/** Spec L193/L181: no frame within this window while `remuxing` → indeterminate. */
export const REMUX_INDETERMINATE_AFTER_MS = 10_000

/** One accepted progress sample. `receivedAt` is local wall-clock millis. */
export interface RemuxProgress {
  readonly sessionId: number
  readonly percent: number
  readonly etaSeconds: number | undefined
  readonly speed: string | undefined
  readonly receivedAt: number
}

/** The parsed wire shape of one `session.{id}.remux.progress` payload. */
export interface RemuxProgressFrame {
  readonly sessionId: number
  readonly percent: number
  readonly etaSeconds: number | undefined
  readonly speed: string | undefined
}

const PERCENT_MIN = 0
const PERCENT_MAX = 100

/**
 * Tolerant parser for the ffmpeg-derived payload. Returns `null` for anything
 * without a numeric `session_id` + `percent`; unknown extra keys are ignored.
 */
export function parseRemuxProgressFrame(payload: unknown): RemuxProgressFrame | null {
  if (typeof payload !== "object" || payload === null) return null
  const record = payload as Record<string, unknown>

  const sessionId = record.session_id
  const percent = record.percent
  if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return null
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null

  const eta = record.eta_seconds
  const speed = record.speed

  return {
    sessionId,
    percent: Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, percent)),
    etaSeconds: typeof eta === "number" && Number.isFinite(eta) ? eta : undefined,
    speed:
      typeof speed === "string"
        ? speed
        : typeof speed === "number" && Number.isFinite(speed)
          ? String(speed)
          : undefined,
  }
}

let activeSessionId: number | null = null
let current: RemuxProgress | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Marks one session as the open detail; its frames are the only accepted ones. */
export function activateRemuxProgress(sessionId: number): void {
  if (activeSessionId === sessionId) return
  activeSessionId = sessionId
  current = null
  emit()
}

/** Clears the open-detail subscription (unmount); a different id is a no-op. */
export function deactivateRemuxProgress(sessionId: number): void {
  if (activeSessionId !== sessionId) return
  activeSessionId = null
  current = null
  emit()
}

/**
 * Routes one frame payload. Frames addressed to a session that is not open (or
 * malformed ones) are dropped and return `false` (spec L193).
 */
export function applyRemuxProgressFrame(payload: unknown): boolean {
  if (activeSessionId === null) return false
  const frame = parseRemuxProgressFrame(payload)
  if (frame === null || frame.sessionId !== activeSessionId) return false

  current = {
    sessionId: frame.sessionId,
    percent: frame.percent,
    etaSeconds: frame.etaSeconds,
    speed: frame.speed,
    receivedAt: Date.now(),
  }
  emit()
  return true
}

/** The latest accepted sample for the open session, or `null`. */
export function getRemuxProgress(sessionId: number): RemuxProgress | null {
  if (activeSessionId !== sessionId) return null
  return current
}

export function subscribeRemuxProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Resets the store; teardown for tests and the future socket teardown. */
export function clearRemuxProgress(): void {
  activeSessionId = null
  current = null
  emit()
}
