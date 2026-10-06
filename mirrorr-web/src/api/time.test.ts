import { describe, expect, it } from "vitest"
import {
  COUNTDOWN_TICK_MS,
  datetimeLocalToNaiveUtc,
  formatBytes,
  formatCountdown,
  formatDuration,
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
})
