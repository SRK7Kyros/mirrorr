import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDateTime } from "@/lib/format"
import {
  NaiveUtcError,
  TIME_MESSAGES,
  datetimeLocalToNaiveUtc,
  isNaiveUtc,
  naiveUtcToDatetimeLocal,
  parseNaiveUtc,
  validateAutorunTimes,
} from "@/lib/time"

const NEW_YORK = "America/New_York"
const WINTER_UTC = "2026-01-15T13:00:00" // 08:00 EST
const SUMMER_UTC = "2026-07-15T12:00:00" // 08:00 EDT
const FIXTURE_NOW = new Date("2026-07-15T12:00:00Z")

function thrownBy(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  return undefined
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseNaiveUtc", () => {
  it("appends Z instead of parsing the naive string in the host zone", () => {
    vi.stubEnv("TZ", NEW_YORK)
    // The trap this guard exists for: JS parses a raw naive string as local wall
    // time, so 12:00 in New York would silently become 17:00Z.
    expect(new Date("2026-01-15T12:00:00").toISOString()).toBe("2026-01-15T17:00:00.000Z")
    expect(parseNaiveUtc("2026-01-15T12:00:00").toISOString()).toBe("2026-01-15T12:00:00.000Z")
  })

  it("accepts fractional seconds the server may emit", () => {
    expect(parseNaiveUtc("2026-01-15T12:00:00.123456").toISOString()).toBe("2026-01-15T12:00:00.123Z")
  })

  it("rejects a value that carries a tz suffix instead of silently shifting it", () => {
    for (const value of ["2026-01-15T12:00:00Z", "2026-01-15T12:00:00+02:00", "2026-01-15T12:00:00-0500"]) {
      expect(() => parseNaiveUtc(value)).toThrow(NaiveUtcError)
      expect(thrownBy(() => parseNaiveUtc(value))).toMatchObject({ reason: "tz-suffixed", value })
    }
  })

  it("rejects malformed and impossible calendar values", () => {
    for (const value of ["2026-01-15", "2026-01-15T12:00", "", "not-a-date", "2026-02-30T12:00:00"]) {
      expect(() => parseNaiveUtc(value)).toThrow(NaiveUtcError)
      expect(thrownBy(() => parseNaiveUtc(value))).toMatchObject({ reason: "malformed", value })
    }
  })
})

describe("isNaiveUtc", () => {
  it("discriminates the naive shape from tz-suffixed and malformed values", () => {
    expect(isNaiveUtc("2026-01-15T12:00:00")).toBe(true)
    expect(isNaiveUtc("2026-01-15T12:00:00.5")).toBe(true)
    expect(isNaiveUtc("2026-01-15T12:00:00Z")).toBe(false)
    expect(isNaiveUtc("2026-01-15T12:00:00+02:00")).toBe(false)
    expect(isNaiveUtc("2026-01-15T12:00")).toBe(false)
  })
})

const NAIVE_UTC_FIELDS = [
  "started_at",
  "ended_at",
  "start_time",
  "end_time",
  "created_at",
  "exported_at",
  "attempts[0].started_at",
  "attempts[0].ended_at",
  "next_run_at",
  "last_run_at",
] as const

describe("the naive-UTC fields the spec lists", () => {
  it.each(NAIVE_UTC_FIELDS)("parses and displays %s as UTC", (_field) => {
    expect(parseNaiveUtc(SUMMER_UTC).toISOString()).toBe("2026-07-15T12:00:00.000Z")
    expect(formatDateTime(SUMMER_UTC, { timeZone: NEW_YORK })).toBe("Jul 15, 2026, 8:00 AM")
  })
})

describe("datetimeLocalToNaiveUtc", () => {
  it("converts the winter wall time with the EST offset", () => {
    expect(datetimeLocalToNaiveUtc("2026-01-15T08:00", { timeZone: NEW_YORK })).toBe("2026-01-15T13:00:00")
  })

  it("converts the summer wall time with the EDT offset", () => {
    expect(datetimeLocalToNaiveUtc("2026-07-15T08:00", { timeZone: NEW_YORK })).toBe("2026-07-15T12:00:00")
  })

  it("serializes without any tz suffix", () => {
    const value = datetimeLocalToNaiveUtc("2026-07-15T08:00", { timeZone: NEW_YORK })
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(value.endsWith("Z")).toBe(false)
  })

  it("rejects a picker value that already carries a tz suffix", () => {
    expect(
      thrownBy(() => datetimeLocalToNaiveUtc("2026-07-15T08:00:00Z", { timeZone: NEW_YORK })),
    ).toMatchObject({ reason: "tz-suffixed" })
  })

  it("rejects malformed picker values", () => {
    expect(
      thrownBy(() => datetimeLocalToNaiveUtc("2026-07-15", { timeZone: NEW_YORK })),
    ).toMatchObject({ reason: "malformed" })
  })
})

describe("naiveUtcToDatetimeLocal", () => {
  it("prefills the wall time the picker shows in winter and summer", () => {
    expect(naiveUtcToDatetimeLocal(WINTER_UTC, { timeZone: NEW_YORK })).toBe("2026-01-15T08:00")
    expect(naiveUtcToDatetimeLocal(SUMMER_UTC, { timeZone: NEW_YORK })).toBe("2026-07-15T08:00")
  })
})

describe("DST round trips", () => {
  const WALLS = [
    "2026-01-15T08:00",
    "2026-03-08T01:30",
    "2026-03-08T03:30",
    "2026-07-15T08:00",
    "2026-11-01T00:30",
    "2026-11-01T01:30",
    "2026-11-01T02:30",
  ] as const

  it.each(WALLS)("round-trips %s stably across the pinned DST zone", (wall) => {
    const utc = datetimeLocalToNaiveUtc(wall, { timeZone: NEW_YORK })
    expect(naiveUtcToDatetimeLocal(utc, { timeZone: NEW_YORK })).toBe(wall)
  })

  it("round-trips the wall time in the host zone", () => {
    for (const wall of ["2026-01-15T08:00", "2026-07-15T08:00"]) {
      expect(naiveUtcToDatetimeLocal(datetimeLocalToNaiveUtc(wall))).toBe(wall)
    }
  })
})

describe("validateAutorunTimes", () => {
  const base = { now: FIXTURE_NOW, timeZone: NEW_YORK }

  it("accepts a future window", () => {
    expect(
      validateAutorunTimes({ ...base, start: "2026-07-15T09:00", end: "2026-07-15T10:00" }),
    ).toEqual({ ok: true, warning: null })
  })

  it("rejects end equal to start", () => {
    expect(
      validateAutorunTimes({ ...base, start: "2026-07-15T09:00", end: "2026-07-15T09:00" }),
    ).toEqual({ ok: false, error: "end-not-after-start" })
  })

  it("rejects end before start", () => {
    expect(
      validateAutorunTimes({ ...base, start: "2026-07-15T10:00", end: "2026-07-15T09:00" }),
    ).toEqual({ ok: false, error: "end-not-after-start" })
  })

  it("allows a past start and warns instead", () => {
    expect(
      validateAutorunTimes({ ...base, start: "2026-07-15T06:00", end: "2026-07-15T07:00" }),
    ).toEqual({ ok: true, warning: "start-in-past" })
  })

  it("reports missing ends and invalid values as field errors", () => {
    expect(validateAutorunTimes({ ...base, start: "", end: "2026-07-15T10:00" })).toEqual({
      ok: false,
      error: "start-required",
    })
    expect(validateAutorunTimes({ ...base, start: "2026-07-15T09:00", end: "" })).toEqual({
      ok: false,
      error: "end-required",
    })
    expect(validateAutorunTimes({ ...base, start: "nope", end: "2026-07-15T10:00" })).toEqual({
      ok: false,
      error: "invalid",
    })
  })
})

describe("TIME_MESSAGES", () => {
  it("carries the spec copy for the pickers", () => {
    expect(TIME_MESSAGES.localTimeHint).toBe("Your local time — stored as UTC")
    expect(TIME_MESSAGES.pastStartWarning).toContain("backfill trigger")
    expect(TIME_MESSAGES.endNotAfterStart).toContain("End time")
  })
})
