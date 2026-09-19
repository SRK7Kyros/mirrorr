/**
 * Display formatters for the time contract (`docs/web-frontend-spec.md`
 * L228-L233). They consume the naive-UTC discipline from `@/lib/time` and are
 * the only place a server datetime becomes user-visible text.
 *
 * - `formatDateTime` uses the system zone; the zone abbreviation is exposed
 *   separately (`localZoneLabel`) so a view renders it ONCE, not per row.
 * - relative time carries the absolute local string in `title` (L228);
 * - countdowns are coarse text on the 10s cadence ("starts in ~3 h 12 min"),
 *   with the 30s "starting…" window (`@/lib/time` holds the tick constants);
 * - durations are `m:ss` under one hour, else `h:mm:ss` (L232);
 * - sizes are binary units with one decimal (L233).
 */
import { STARTING_WINDOW_MS, parseNaiveUtc, type TimeZoneOptions } from "@/lib/time"

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const SYSTEM_ZONE = "\u0000system"
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()
const labelFormatters = new Map<string, Intl.DateTimeFormat>()

/** `Sep 7, 2026, 10:00` local display (spec L228). */
export function formatDateTime(value: string, options: TimeZoneOptions = {}): string {
  const key = options.timeZone ?? SYSTEM_ZONE
  let formatter = dateTimeFormatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: options.timeZone,
    })
    dateTimeFormatters.set(key, formatter)
  }
  return formatter.format(parseNaiveUtc(value))
}

/** The zone abbreviation ("CEST", "EST") — render it ONCE per view (L228). */
export function localZoneLabel(at: Date, options: TimeZoneOptions = {}): string {
  const key = options.timeZone ?? SYSTEM_ZONE
  let formatter = labelFormatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short",
      timeZone: options.timeZone,
    })
    labelFormatters.set(key, formatter)
  }
  const part = formatter.formatToParts(at).find((piece) => piece.type === "timeZoneName")
  return part?.value ?? new Intl.DateTimeFormat().resolvedOptions().timeZone
}

export interface RelativeTime {
  readonly text: string
  /** The absolute local string for the `title` tooltip (spec L228). */
  readonly title: string
}

function relativeText(diffMs: number): string {
  if (diffMs <= -DAY_MS) return `${Math.floor(-diffMs / DAY_MS)} d ago`
  if (diffMs <= -HOUR_MS) return `${Math.floor(-diffMs / HOUR_MS)} h ago`
  if (diffMs <= -MINUTE_MS) return `${Math.floor(-diffMs / MINUTE_MS)} min ago`
  if (diffMs < 0) return "just now"
  if (diffMs < MINUTE_MS) return "in <1 min"
  if (diffMs < HOUR_MS) return `in ${Math.floor(diffMs / MINUTE_MS)} min`
  if (diffMs < DAY_MS) return `in ${Math.floor(diffMs / HOUR_MS)} h`
  return `in ${Math.floor(diffMs / DAY_MS)} d`
}

/** Relative text plus the absolute local string for the `title` tooltip. */
export function formatRelativeTime(
  value: string,
  now: Date,
  options: TimeZoneOptions = {},
): RelativeTime {
  const diffMs = parseNaiveUtc(value).getTime() - now.getTime()
  return { text: relativeText(diffMs), title: formatDateTime(value, options) }
}

/**
 * Autorun countdown text, or `null` once the 30s "starting…" window has passed
 * (the row then relies on the WS event — spec L231).
 */
export function formatCountdown(startTime: string, now: Date): string | null {
  const diffMs = parseNaiveUtc(startTime).getTime() - now.getTime()
  if (diffMs <= 0) return diffMs >= -STARTING_WINDOW_MS ? "starting…" : null

  const days = Math.floor(diffMs / DAY_MS)
  const hours = Math.floor((diffMs % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((diffMs % HOUR_MS) / MINUTE_MS)

  if (days > 0) return hours > 0 ? `starts in ~${days} d ${hours} h` : `starts in ~${days} d`
  if (hours > 0) return minutes > 0 ? `starts in ~${hours} h ${minutes} min` : `starts in ~${hours} h`
  if (minutes > 0) return `starts in ~${minutes} min`
  return "starts in ~<1 min"
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3_600

function twoDigits(value: number): string {
  return String(value).padStart(2, "0")
}

/** `m:ss` under an hour, `h:mm:ss` from one hour (spec L232). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`Duration must be non-negative seconds: ${totalSeconds}`)
  }
  const whole = Math.floor(totalSeconds)
  const hours = Math.floor(whole / SECONDS_PER_HOUR)
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = whole % SECONDS_PER_MINUTE
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${minutes}:${twoDigits(seconds)}`
}

/** Final duration from `started_at`→`ended_at`, live from `started_at`→now. */
export function formatSessionDuration(startedAt: string, endedAt: string | null, now: Date): string {
  const start = parseNaiveUtc(startedAt)
  const end = endedAt === null ? now : parseNaiveUtc(endedAt)
  return formatDuration(Math.max(0, (end.getTime() - start.getTime()) / 1_000))
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/** `size_bytes` → binary units, one decimal (spec L233: "842.3 MB"). */
export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new RangeError(`Size must be non-negative bytes: ${sizeBytes}`)
  }
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`

  let value = sizeBytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // A value that rounds to 1024.0 belongs to the next unit.
  if (Number(value.toFixed(1)) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`
}
