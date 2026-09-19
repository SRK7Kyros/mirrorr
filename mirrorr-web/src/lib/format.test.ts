import { describe, expect, it } from "vitest"
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatSessionDuration,
  localZoneLabel,
} from "@/lib/format"

const NEW_YORK = "America/New_York"
const FIXTURE_NOW = new Date("2026-07-15T12:00:00Z")

describe("formatDateTime", () => {
  it("renders the winter value in the pinned zone", () => {
    expect(formatDateTime("2026-01-15T13:00:00", { timeZone: NEW_YORK })).toBe("Jan 15, 2026, 8:00 AM")
  })

  it("renders the summer value in the pinned zone", () => {
    expect(formatDateTime("2026-07-15T12:00:00", { timeZone: NEW_YORK })).toBe("Jul 15, 2026, 8:00 AM")
  })
})

describe("localZoneLabel", () => {
  it("labels the pinned zone with its winter and summer abbreviations", () => {
    expect(localZoneLabel(new Date("2026-01-15T12:00:00Z"), { timeZone: NEW_YORK })).toBe("EST")
    expect(localZoneLabel(new Date("2026-07-15T12:00:00Z"), { timeZone: NEW_YORK })).toBe("EDT")
  })

  it("labels the system zone when none is pinned", () => {
    expect(localZoneLabel(FIXTURE_NOW).length).toBeGreaterThan(0)
  })
})

describe("formatRelativeTime", () => {
  it("puts the absolute local string in the title", () => {
    expect(formatRelativeTime("2026-07-15T11:58:00", FIXTURE_NOW, { timeZone: NEW_YORK })).toEqual({
      text: "2 min ago",
      title: "Jul 15, 2026, 7:58 AM",
    })
  })

  it("formats future spans and sub-minute edges", () => {
    expect(formatRelativeTime("2026-07-15T15:00:00", FIXTURE_NOW, { timeZone: NEW_YORK }).text).toBe("in 3 h")
    expect(formatRelativeTime("2026-07-15T12:00:30", FIXTURE_NOW, { timeZone: NEW_YORK }).text).toBe("in <1 min")
    expect(formatRelativeTime("2026-07-15T11:59:30", FIXTURE_NOW, { timeZone: NEW_YORK }).text).toBe("just now")
    expect(formatRelativeTime("2026-07-18T12:00:00", FIXTURE_NOW, { timeZone: NEW_YORK }).text).toBe("in 3 d")
  })
})

describe("formatCountdown", () => {
  it("uses coarse text for a future start", () => {
    expect(formatCountdown("2026-07-15T15:12:00", FIXTURE_NOW)).toBe("starts in ~3 h 12 min")
  })

  it("uses day granularity for multi-day spans", () => {
    expect(formatCountdown("2026-07-17T14:00:00", FIXTURE_NOW)).toBe("starts in ~2 d 2 h")
  })

  it("never uses seconds precision", () => {
    expect(formatCountdown("2026-07-15T12:45:00", FIXTURE_NOW)).toBe("starts in ~45 min")
    expect(formatCountdown("2026-07-15T12:00:30", FIXTURE_NOW)).toBe("starts in ~<1 min")
  })

  it("shows starting… for up to 30s after the start passes", () => {
    expect(formatCountdown("2026-07-15T12:00:00", FIXTURE_NOW)).toBe("starting…")
    expect(formatCountdown("2026-07-15T11:59:55", FIXTURE_NOW)).toBe("starting…")
    expect(formatCountdown("2026-07-15T11:59:30", FIXTURE_NOW)).toBe("starting…")
  })

  it("returns null once the 30s window has passed", () => {
    expect(formatCountdown("2026-07-15T11:59:29", FIXTURE_NOW)).toBeNull()
  })
})

describe("formatDuration", () => {
  it("switches from m:ss to h:mm:ss at the hour boundary", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(59)).toBe("0:59")
    expect(formatDuration(60)).toBe("1:00")
    expect(formatDuration(3_599)).toBe("59:59")
    expect(formatDuration(3_600)).toBe("1:00:00")
    expect(formatDuration(3_661)).toBe("1:01:01")
    expect(formatDuration(90_061)).toBe("25:01:01")
  })

  it("floors fractional seconds", () => {
    expect(formatDuration(65.9)).toBe("1:05")
  })

  it("rejects negative and non-finite values", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError)
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError)
  })
})

describe("formatSessionDuration", () => {
  it("uses ended_at for a final session", () => {
    expect(formatSessionDuration("2026-07-15T12:00:00", "2026-07-15T12:01:05", FIXTURE_NOW)).toBe("1:05")
  })

  it("uses now for a live session", () => {
    expect(formatSessionDuration("2026-07-15T12:00:00", null, new Date("2026-07-15T12:00:59Z"))).toBe("0:59")
    expect(formatSessionDuration("2026-07-15T12:00:00", null, new Date("2026-07-15T12:01:00Z"))).toBe("1:00")
  })

  it("clamps a malformed negative span to zero", () => {
    expect(formatSessionDuration("2026-07-15T12:00:00", "2026-07-15T11:00:00", FIXTURE_NOW)).toBe("0:00")
  })
})

describe("formatBytes", () => {
  it("uses B below 1024 and binary units with one decimal above", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1023)).toBe("1023 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(842.3 * 1024 * 1024)).toBe("842.3 MB")
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB")
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB")
  })

  it("carries a value that rounds to 1024.0 into the next unit", () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe("1.0 MB")
    expect(formatBytes(1024 ** 3 - 1)).toBe("1.0 GB")
  })

  it("rejects negative and non-finite values", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError)
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError)
  })
})
