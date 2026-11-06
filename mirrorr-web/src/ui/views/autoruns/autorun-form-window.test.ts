import { describe, expect, it } from "vitest"
import { formatWindowLength, windowNote } from "./autorun-form-window"

describe("formatWindowLength", () => {
  it("speaks the window in whole hours and minutes", () => {
    expect(formatWindowLength("2026-11-07T21:00", "2026-11-07T23:00")).toBe("2 h")
    expect(formatWindowLength("2026-11-07T21:00", "2026-11-07T21:45")).toBe("45 min")
    expect(formatWindowLength("2026-11-07T21:00", "2026-11-07T22:30")).toBe("1 h 30 min")
  })

  it("says nothing until both ends are picked, or when they do not form a window", () => {
    expect(formatWindowLength("", "2026-11-07T23:00")).toBeNull()
    expect(formatWindowLength("2026-11-07T21:00", "")).toBeNull()
    expect(formatWindowLength("2026-11-07T21:00", "2026-11-07T21:00")).toBeNull()
    expect(formatWindowLength("2026-11-07T22:00", "2026-11-07T21:00")).toBeNull()
  })
})

describe("windowNote", () => {
  const noon = new Date("2026-11-07T12:00:00Z")

  it("is one line for the pair: whose clock, what is stored, how long", () => {
    const note = windowNote("2 h", noon)
    expect(note).toBe("Times are in your local zone (GMT); the server stores UTC. 2 h long.")
    expect(note.match(/local zone/g)).toHaveLength(1)
    expect(note.match(/UTC/g)).toHaveLength(1)
  })

  it("still names the zone before a length is known", () => {
    expect(windowNote(null, noon)).toBe(
      "Times are in your local zone (GMT); the server stores UTC.",
    )
  })
})
