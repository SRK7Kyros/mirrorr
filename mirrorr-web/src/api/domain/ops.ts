import { formatBytes, formatCountdown, formatDuration } from "@/api/time"
import type { Overview } from "@/api/schemas"

/** Below this much free space a capture is likely to die mid-run. */
export const DISK_WARNING_BYTES = 10 * 1024 ** 3
/** The core refuses to start a capture below its own guard; this is danger. */
export const DISK_DANGER_BYTES = 2 * 1024 ** 3

export type OpsTone = "normal" | "warning" | "danger"

export function diskTone(freeBytes: number): OpsTone {
  if (freeBytes < DISK_DANGER_BYTES) return "danger"
  if (freeBytes < DISK_WARNING_BYTES) return "warning"
  return "normal"
}

export interface LiveReadout {
  readonly live: number
  readonly notes: readonly string[]
}

/** Live sessions, with whatever is on its way in or out named beside them. */
export function liveReadout(sessions: Overview["sessions"]): LiveReadout {
  const notes: string[] = []
  if (sessions.starting > 0) notes.push(`${sessions.starting} starting`)
  if (sessions.finishing > 0) notes.push(`${sessions.finishing} finishing`)
  return { live: sessions.live, notes }
}

/** `"12 recordings · 34.2 GB · 6:13:20"`. */
export function storageReadout(recordings: Overview["recordings"]): string {
  const noun = recordings.count === 1 ? "recording" : "recordings"
  const parts = [`${recordings.count} ${noun}`, formatBytes(recordings.size_bytes)]
  if (recordings.seconds > 0) parts.push(formatDuration(recordings.seconds))
  return parts.join(" · ")
}

export interface NextRunReadout {
  readonly name: string
  readonly countdown: string
}

/** The schedule that fires next, or `null` when none is pending. */
export function nextRunReadout(
  next: Overview["next_autorun"],
  now: Date = new Date(),
): NextRunReadout | null {
  if (next === null || next === undefined) return null
  return { name: next.name, countdown: formatCountdown(next.starts_at, now) }
}
