/**
 * The naive-UTC time discipline in one module.
 *
 * Contract: `docs/web-frontend-spec.md` L223-L234 ("Time & UTC Handling") and
 * `docs/general-client-specification.md` §5, §12.3, §13.9.1. Every server
 * datetime — `started_at`, `ended_at`, `start_time`, `end_time`, `created_at`,
 * `exported_at`, `attempts[].started_at/ended_at`, `next_run_at`, `last_run_at`
 * — is naive UTC (no `Z`, no offset).
 *
 * Rules encoded here and nowhere else:
 * - parse with an appended `Z` (never `new Date(value)` on a naive string);
 *   a value that already carries a tz suffix is REJECTED, not silently shifted;
 * - `datetime-local` wall times convert local → UTC on submit as
 *   `YYYY-MM-DDTHH:mm:ss` with no suffix (a suffix 422s — §13.9.1), and back
 *   for edit forms;
 * - autorun windows validate `end > start` and warn on a past start.
 *
 * Display strings (Intl formatting, relative time, countdowns, durations,
 * sizes) live in the companion `@/lib/format` module.
 */

const SECOND_MS = 1_000

/** The naive shape the server emits: seconds required, sub-seconds allowed. */
const NAIVE_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/

/** A tz suffix at the end of the value (`Z`, `+02:00`, `-0500`). */
const TZ_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** The `datetime-local` value shape: minute precision, seconds optional. */
const WALL_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/

/** Autorun countdown cadence (spec L231: the scheduler ticks ~10s). */
export const COUNTDOWN_TICK_MS = 10_000

/** Live session duration cadence (spec L232: the open detail view only). */
export const LIVE_DURATION_TICK_MS = 1_000

/** "starting…" shows for up to 30s after `start_time` passes (spec L231). */
export const STARTING_WINDOW_MS = 30_000

/** Spec-copy for the autorun time fields (L229-L230), rendered by the views. */
export const TIME_MESSAGES = {
  localTimeHint: "Your local time — stored as UTC",
  pastStartWarning: "starts immediately — server treats past times as a backfill trigger",
  endNotAfterStart: "End time must be after the start time",
  startRequired: "Start time is required",
  endRequired: "End time is required",
  invalid: "Enter a valid local time",
} as const

export type NaiveUtcErrorReason = "tz-suffixed" | "malformed"

/** Thrown when a value is not a naive-UTC datetime where one is required. */
export class NaiveUtcError extends Error {
  readonly reason: NaiveUtcErrorReason
  readonly value: string

  constructor(reason: NaiveUtcErrorReason, value: string) {
    super(
      reason === "tz-suffixed"
        ? `Expected naive UTC without a tz suffix: ${value}`
        : `Malformed naive UTC value: ${value}`,
    )
    this.name = "NaiveUtcError"
    this.reason = reason
    this.value = value
  }
}

export function isNaiveUtc(value: string): boolean {
  return NAIVE_UTC_PATTERN.test(value)
}

/** Naive UTC → instant: appends `Z`; rejects tz-suffixed and malformed values. */
export function parseNaiveUtc(value: string): Date {
  if (TZ_SUFFIX_PATTERN.test(value)) throw new NaiveUtcError("tz-suffixed", value)
  if (!isNaiveUtc(value)) throw new NaiveUtcError("malformed", value)

  const instant = new Date(`${value}Z`)
  // Impossible calendar dates roll over (2026-02-30 → Mar 2); reject them.
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new NaiveUtcError("malformed", value)
  }
  return instant
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0")
}

/** `Date` → `YYYY-MM-DDTHH:mm:ss` in UTC, never with a suffix (§13.9.1). */
function serializeNaiveUtc(instant: Date): string {
  const date = `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`
  const time = `${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}:${pad(instant.getUTCSeconds())}`
  return `${date}T${time}`
}

export interface TimeZoneOptions {
  /** IANA zone; omitted = the system zone (the spec's local display). */
  readonly timeZone?: string
}

interface WallParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>()

/** Wall-clock fields of an instant in the system or a pinned zone. */
function wallParts(instant: Date, timeZone: string | undefined): WallParts {
  if (timeZone === undefined) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
    }
  }

  let formatter = wallFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    wallFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(instant)
  const read = (type: "year" | "month" | "day" | "hour" | "minute" | "second"): number =>
    Number(parts.find((piece) => piece.type === type)?.value)
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  }
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = wallParts(instant, timeZone)
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return wallAsUtc - (instant.getTime() - (instant.getTime() % SECOND_MS))
}

function instantFromWall(parts: WallParts, timeZone: string | undefined): Date {
  if (timeZone === undefined) {
    return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  }
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const firstPass = guess - zoneOffsetMs(new Date(guess), timeZone)
  return new Date(guess - zoneOffsetMs(new Date(firstPass), timeZone))
}

function parseWallInput(localValue: string): WallParts {
  if (TZ_SUFFIX_PATTERN.test(localValue)) throw new NaiveUtcError("tz-suffixed", localValue)
  if (!WALL_INPUT_PATTERN.test(localValue)) throw new NaiveUtcError("malformed", localValue)

  const [datePart = "", timePart = ""] = localValue.split("T")
  const [year = 0, month = 0, day = 0] = datePart.split("-").map(Number)
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number)
  return { year, month, day, hour, minute, second }
}

/** `datetime-local` wall time → naive-UTC string (no suffix, §13.9.1). */
export function datetimeLocalToNaiveUtc(localValue: string, options: TimeZoneOptions = {}): string {
  return serializeNaiveUtc(instantFromWall(parseWallInput(localValue), options.timeZone))
}

/** Naive UTC → the `datetime-local` wall time an edit form prefills. */
export function naiveUtcToDatetimeLocal(value: string, options: TimeZoneOptions = {}): string {
  const parts = wallParts(parseNaiveUtc(value), options.timeZone)
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
  return `${date}T${pad(parts.hour)}:${pad(parts.minute)}`
}

export type AutorunTimeError = "start-required" | "end-required" | "invalid" | "end-not-after-start"
export type AutorunTimeWarning = "start-in-past"

export type AutorunTimeValidation =
  | { readonly ok: true; readonly warning: AutorunTimeWarning | null }
  | { readonly ok: false; readonly error: AutorunTimeError }

export interface AutorunTimeInput {
  readonly start: string
  readonly end: string
  readonly now: Date
  readonly timeZone?: string
}

/** `end > start` with the past-start warning (spec L230). */
export function validateAutorunTimes(input: AutorunTimeInput): AutorunTimeValidation {
  if (input.start.trim().length === 0) return { ok: false, error: "start-required" }
  if (input.end.trim().length === 0) return { ok: false, error: "end-required" }

  const options = { timeZone: input.timeZone }
  let startUtc: string
  let endUtc: string
  try {
    startUtc = datetimeLocalToNaiveUtc(input.start, options)
    endUtc = datetimeLocalToNaiveUtc(input.end, options)
  } catch (error) {
    if (error instanceof NaiveUtcError) return { ok: false, error: "invalid" }
    throw error
  }

  // Both ends are fixed-width naive UTC, so lexicographic order is chronological.
  if (endUtc <= startUtc) return { ok: false, error: "end-not-after-start" }
  if (startUtc < serializeNaiveUtc(input.now)) return { ok: true, warning: "start-in-past" }
  return { ok: true, warning: null }
}
