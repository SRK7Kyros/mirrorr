import { describe, expect, it } from "vitest"
import {
  COUNTDOWN_TICK_MS,
  datetimeLocalToNaiveUtc,
  elapsedSeconds,
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatDateTimePair,
  formatDuration,
  formatWindow,
  naiveUtcToDatetimeLocal,
  parseNaiveUtc,
  toNaiveUtc,
} from "./time"

describe("naive UTC discipline", () => {
  it("parses naive strings as UTC and round-trips through serialization", () => {
    const naive = "2026-06-15T10:30:00"
    const parsed = parseNaiveUtc(naive)
    expect(parsed.toISOString()).toBe("2026-06-15T10:30:00.000Z")
    expect(toNaiveUtc(parsed)).toBe(naive)
  })

  it("round-trips datetime-local ↔ naive UTC regardless of local timezone", () => {
    const naive = "2026-06-15T10:30:00"
    const local = naiveUtcToDatetimeLocal(naive)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(datetimeLocalToNaiveUtc(local)).toBe(naive)
  })

  it("never emits a Z or offset suffix (server 422s on them)", () => {
    const serialized = datetimeLocalToNaiveUtc("2026-06-15T10:30")
    expect(serialized).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })

  it("rejects unparseable input instead of producing Invalid Date", () => {
    expect(() => parseNaiveUtc("not-a-date")).toThrow()
    expect(() => datetimeLocalToNaiveUtc("nope")).toThrow()
  })
})

describe("formatters", () => {
  it("formats countdown text on the 10s tick contract", () => {
    expect(COUNTDOWN_TICK_MS).toBe(10_000)
    const now = parseNaiveUtc("2026-06-15T07:00:00")
    expect(formatCountdown("2026-06-15T10:12:00", now)).toBe("starts in ~3 h 12 min")
    expect(formatCountdown("2026-06-15T07:45:00", now)).toBe("starts in ~45 min")
    expect(formatCountdown("2026-06-15T06:00:00", now)).toBe("starting…")
  })

  it("formats binary sizes with 1 decimal", () => {
    expect(formatBytes(Math.round(842.3 * 1024 * 1024))).toBe("842.3 MB")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(0)).toBe("0 B")
  })

  it("formats durations as m:ss under an hour, else h:mm:ss", () => {
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(9)).toBe("0:09")
    expect(formatDuration(3661)).toBe("1:01:01")
  })

  it("measures the gap between two stamps, and gives up on an unparseable or missing one", () => {
    expect(elapsedSeconds("2026-10-13T21:09:00", "2026-10-13T22:04:00")).toBe(3300)
    expect(elapsedSeconds("2026-10-13T21:09:00", null)).toBeNull()
    expect(elapsedSeconds(null, "2026-10-13T22:04:00")).toBeNull()
    expect(elapsedSeconds("nope", "2026-10-13T22:04:00")).toBeNull()
    expect(elapsedSeconds("2026-10-13T22:04:00", "2026-10-13T21:09:00")).toBe(0)
  })

  it("drops the year unless the stamp is not from this one", () => {
    const now = parseNaiveUtc("2026-06-15T12:00:00")
    expect(formatDateTime("2026-06-15T19:15:00", now)).not.toContain("2026")
    expect(formatDateTime("2025-06-15T19:15:00", now)).toContain("2025")
    expect(formatDateTime("nope")).toBe("—")
  })

  it("stacks a pair, printing the day once when both stamps share one", () => {
    const now = parseNaiveUtc("2026-10-14T12:00:00")
    const same = formatDateTimePair("2026-10-13T22:04:00", "2026-10-13T22:42:00", now)
    expect(same?.start).toBe(formatDateTime("2026-10-13T22:04:00", now))
    expect(same?.end.length).toBeLessThan((same?.start ?? "").length)
    const across = formatDateTimePair("2026-10-13T23:29:00", "2026-10-14T00:38:00", now)
    expect(across?.end).toBe(formatDateTime("2026-10-14T00:38:00", now))
    expect(formatDateTimePair("nope", "2026-10-14T00:38:00", now)).toBeNull()
  })

  it("splits a window into a date line and a time line, dropping this year", () => {
    const now = parseNaiveUtc("2026-06-15T23:59:00")
    const window = formatWindow("2026-06-15T19:15:00", "2026-06-15T20:45:00", now)
    expect(window?.date).not.toContain("2026")
    expect(window?.time).toEqual(expect.stringMatching(/\d{1,2}:\d{2}/))
    expect(window?.time).not.toContain("2026")
    expect(formatWindow("2025-06-15T19:15:00", "2025-06-15T20:45:00", now)?.date).toContain("2025")
  })

  it("rolls hours into days past 24 h", () => {
    const now = parseNaiveUtc("2026-06-05T07:00:00")
    expect(formatCountdown("2026-06-15T11:12:00", now)).toBe("starts in ~10 d 4 h")
    expect(formatCountdown("2026-06-15T07:00:00", now)).toBe("starts in ~10 d")
  })

  it("keeps multi-day windows date-free on the time line", () => {
    const now = parseNaiveUtc("2026-10-23T12:00:00")
    const window = formatWindow("2026-10-23T22:45:00", "2026-10-24T00:15:00", now)
    expect(window?.date).not.toContain("2026")
    expect(window?.time).toEqual(expect.stringMatching(/→/))
    expect(window?.time).not.toMatch(/2026|\//)
  })

  it("returns null when either end is unparseable", () => {
    expect(formatWindow("nope", "2026-06-15T19:15:00")).toBeNull()
    expect(formatWindow("2026-06-15T19:15:00", "nope")).toBeNull()
  })
})
