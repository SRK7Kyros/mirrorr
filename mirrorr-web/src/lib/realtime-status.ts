/**
 * Connection-status seam for the top-bar dot.
 *
 * Contract: `docs/web-frontend-spec.md` L165-L171 — the dot is green when the
 * event socket is open, amber while reconnecting, red while offline/polling,
 * and it must always pair `role="status"` with a text label, never colour
 * alone (L498). Todo 18's RealtimeManager is the only production writer; this
 * module exists so the dot can be built before the socket.
 */
export type RealtimeStatus = "live" | "reconnecting" | "offline"

/** The dot's visible text; the colour is decoration on top of this. */
export const REALTIME_STATUS_LABELS: Readonly<Record<RealtimeStatus, string>> = {
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Polling",
}

/** Before the socket manager exists the honest state is "offline" (polling). */
export const DEFAULT_REALTIME_STATUS: RealtimeStatus = "offline"

let status: RealtimeStatus = DEFAULT_REALTIME_STATUS
const listeners = new Set<() => void>()

export function getRealtimeStatus(): RealtimeStatus {
  return status
}

export function setRealtimeStatus(next: RealtimeStatus): void {
  if (next === status) return
  status = next
  for (const listener of listeners) listener()
}

export function subscribeToRealtimeStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetRealtimeStatus(): void {
  setRealtimeStatus(DEFAULT_REALTIME_STATUS)
}
