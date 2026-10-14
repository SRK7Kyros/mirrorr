/**
 * Naive-UTC time discipline: every server datetime arrives WITHOUT a `Z`
 * suffix and must never be parsed as local time (contract §Time & UTC).
 */
/** Parse `YYYY-MM-DDTHH:mm:ss` (naive UTC) — always appends `Z`. Throws on invalid input. */
export function parseNaiveUtc(value: string): Date {
  const date = tryParseNaiveUtc(value)
  if (date === null) throw new Error(`Invalid naive UTC datetime: ${value}`)
  return date
}

function tryParseNaiveUtc(value: string): Date | null {
  const iso = value.endsWith("Z") ? value : `${value}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0")
}

/** Serialize a `Date` to naive UTC `YYYY-MM-DDTHH:mm:ss` — no tz suffix. */
export function toNaiveUtc(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  )
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const DATE_TIME_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const TIME_ONLY = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

/**
 * Display formatter — local timezone, short date + short time. The year is
 * dropped unless it is not the current one: repeating it on every row is noise
 * nobody reads.
 */
export function formatDateTime(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === "string" ? tryParseNaiveUtc(value) : value
  if (date === null) return "—"
  return (date.getFullYear() === now.getFullYear() ? DATE_TIME : DATE_TIME_YEAR).format(date)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * A start/end pair for stacked lines: the day is printed once, on the start
 * line, when both stamps fall on it.
 */
export function formatDateTimePair(
  start: string | Date,
  end: string | Date,
  now: Date = new Date(),
): { readonly start: string; readonly end: string } | null {
  const from = typeof start === "string" ? tryParseNaiveUtc(start) : start
  const to = typeof end === "string" ? tryParseNaiveUtc(end) : end
  if (from === null || to === null) return null
  return {
    start: formatDateTime(from, now),
    end: sameDay(from, to) ? TIME_ONLY.format(to) : formatDateTime(to, now),
  }
}

const WINDOW_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const WINDOW_DATE_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
})

/** Start/end as two short lines — dates above times, one-day windows collapsed. */
export function formatWindow(
  start: string | Date,
  end: string | Date,
  now: Date = new Date(),
): { readonly date: string; readonly time: string } | null {
  const from = typeof start === "string" ? tryParseNaiveUtc(start) : start
  const to = typeof end === "string" ? tryParseNaiveUtc(end) : end
  if (from === null || to === null) return null
  const thisYear =
    from.getFullYear() === now.getFullYear() && to.getFullYear() === now.getFullYear()
  return {
    date: (thisYear ? WINDOW_DATE : WINDOW_DATE_YEAR).formatRange(from, to),
    time: sameDay(from, to)
      ? TIME_ONLY.formatRange(from, to)
      : `${TIME_ONLY.format(from)} → ${TIME_ONLY.format(to)}`,
  }
}

/** Relative label for list rows ("2 min ago", "in 3 hr"). */
export function formatRelativeTime(target: string | Date, now: Date = new Date()): string {
  const date = typeof target === "string" ? tryParseNaiveUtc(target) : target
  if (date === null) return "—"
  const diffMs = date.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" })
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) return rtf.format(Math.round(diffMs / 1000), "second")
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute")
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour")
  return rtf.format(Math.round(diffMs / day), "day")
}

/**
 * `<input type="datetime-local">` value (local wall time) → naive UTC string.
 * `new Date(localValue)` parses as local per spec; serialize UTC parts with
 * no offset — the server 422s on `Z`/offset suffixes.
 */
export function datetimeLocalToNaiveUtc(localValue: string): string {
  const date = new Date(localValue)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime-local value: ${localValue}`)
  }
  return toNaiveUtc(date)
}

/** Prefill a `datetime-local` input from a naive UTC string (local wall time). */
export function naiveUtcToDatetimeLocal(value: string): string {
  const date = tryParseNaiveUtc(value)
  if (date === null) return ""
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Scheduler countdown granularity — never show seconds precision. */
export const COUNTDOWN_TICK_MS = 10_000

/** "starts in ~10 d 4 h" / "~3 h 12 min" / "~45 min" before start; "starting…" after. */
export function formatCountdown(startTime: string, now: Date = new Date()): string {
  const target = tryParseNaiveUtc(startTime)
  if (target === null) return "—"
  const deltaMs = target.getTime() - now.getTime()
  if (deltaMs <= 0) return "starting…"
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) {
    return hours > 0 ? `starts in ~${days} d ${hours} h` : `starts in ~${days} d`
  }
  if (hours > 0) {
    return minutes > 0 ? `starts in ~${hours} h ${minutes} min` : `starts in ~${hours} h`
  }
  return `starts in ~${minutes} min`
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

/** Binary units, 1 decimal above bytes ("842.3 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const unit = BYTE_UNITS[unitIndex]
  return unitIndex === 0 ? `${Math.round(value)} ${unit}` : `${value.toFixed(1)} ${unit}`
}

/** `m:ss` under an hour, else `h:mm:ss` (recordings/live sessions). */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${Math.floor(total / 60)}:${pad(seconds)}`
}

/** Seconds between two naive-UTC stamps; `null` unless both parse. */
export function elapsedSeconds(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null
  const from = tryParseNaiveUtc(start)
  const to = tryParseNaiveUtc(end)
  if (from === null || to === null) return null
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000))
}
