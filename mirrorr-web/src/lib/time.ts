/**
 * Naive-UTC time discipline: every server datetime arrives WITHOUT a `Z`
 * suffix and must never be parsed as local time (contract §Time & UTC).
 */
export type NaiveUtc = string & { readonly __brand: "naive-utc" }

/** Parse `YYYY-MM-DDTHH:mm:ss` (naive UTC) — always appends `Z`. */
export function parseNaiveUtc(value: string): Date {
  const iso = value.endsWith("Z") ? value : `${value}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid naive UTC datetime: ${value}`)
  }
  return date
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

/** Display formatter — local timezone, medium date + short time. */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? parseNaiveUtc(value) : value
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  )
}

/** Relative label for list rows ("2 min ago", "in 3 hr"). */
export function formatRelativeTime(target: string | Date, now: Date = new Date()): string {
  const date = typeof target === "string" ? parseNaiveUtc(target) : target
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
  const date = parseNaiveUtc(value)
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Scheduler countdown granularity — never show seconds precision. */
export const COUNTDOWN_TICK_MS = 10_000

/** "starts in ~3 h 12 min" before `start_time`; "starting…" once it has passed. */
export function formatCountdown(startTime: string, now: Date = new Date()): string {
  const target = parseNaiveUtc(startTime)
  const deltaMs = target.getTime() - now.getTime()
  if (deltaMs <= 0) return "starting…"
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
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
