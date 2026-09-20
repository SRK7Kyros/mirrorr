import { describe, expect, it } from "vitest"
import {
  DEFAULT_AUTORUN_FILTER,
  autorunMatchesFilter,
  autorunStatusFamily,
  isSpentAutorun,
  parseAutorunFilter,
  shouldAutoExhaustAutoruns,
  toggleAutorunFilterToken,
} from "@/lib/autorun-filters"

/**
 * V5 filter grammar (`docs/web-frontend-spec.md` L284-L287): `+`-joined
 * tokens, default `scheduled+live`, spent separated, unknown tokens dropped,
 * empty → `all`, and a non-`all` filter auto-exhausts pagination.
 */

describe("parseAutorunFilter", () => {
  it("defaults to scheduled+live when the parameter is absent or blank", () => {
    for (const raw of [undefined, null, "", "   "]) {
      const filter = parseAutorunFilter(raw)
      expect(filter.canonical).toBe(DEFAULT_AUTORUN_FILTER)
      expect(filter.isAll).toBe(false)
      expect([...filter.tokens].sort()).toEqual(["live", "scheduled"])
    }
  })

  it("parses the canonical +-joined set in a stable order", () => {
    expect(parseAutorunFilter("live+scheduled").canonical).toBe("scheduled+live")
    expect(parseAutorunFilter("spent+scheduled").canonical).toBe("scheduled+spent")
  })

  it("treats all as everything", () => {
    const filter = parseAutorunFilter("all")
    expect(filter.isAll).toBe(true)
    expect(filter.canonical).toBe("all")
    expect(autorunMatchesFilter("failed", filter)).toBe(true)
    expect(autorunMatchesFilter("recording", filter)).toBe(true)
  })

  it("drops unknown tokens and trims/lowercases the rest", () => {
    expect(parseAutorunFilter(" Live + bogus + SPENT ").canonical).toBe("live+spent")
  })

  it("maps an all-unknown or +-empty result to all", () => {
    expect(parseAutorunFilter("bogus").isAll).toBe(true)
    expect(parseAutorunFilter("+").isAll).toBe(true)
    expect(parseAutorunFilter("all+bogus").isAll).toBe(true)
  })
})

describe("status families", () => {
  it("buckets every live status into live", () => {
    for (const status of ["active", "recording", "terminating", "remuxing", "finalizing"]) {
      expect(autorunStatusFamily(status)).toBe("live")
      expect(autorunMatchesFilter(status, parseAutorunFilter("live"))).toBe(true)
      expect(autorunMatchesFilter(status, parseAutorunFilter("scheduled"))).toBe(false)
    }
  })

  it("buckets spent statuses separately and flags them for 60% opacity", () => {
    for (const status of ["completed", "failed"]) {
      expect(autorunStatusFamily(status)).toBe("spent")
      expect(isSpentAutorun(status)).toBe(true)
      expect(autorunMatchesFilter(status, parseAutorunFilter("spent"))).toBe(true)
      expect(autorunMatchesFilter(status, parseAutorunFilter(DEFAULT_AUTORUN_FILTER))).toBe(false)
    }
    expect(isSpentAutorun("scheduled")).toBe(false)
  })

  it("does not let unknown statuses leak into any token but all", () => {
    expect(autorunStatusFamily("weird")).toBe("unknown")
    expect(autorunMatchesFilter("weird", parseAutorunFilter("scheduled+live+spent"))).toBe(false)
    expect(autorunMatchesFilter("weird", parseAutorunFilter("all"))).toBe(true)
  })
})

describe("toggleAutorunFilterToken", () => {
  it("adds and removes tokens, serializing canonically", () => {
    expect(toggleAutorunFilterToken(parseAutorunFilter("scheduled"), "spent")).toBe("scheduled+spent")
    expect(toggleAutorunFilterToken(parseAutorunFilter("scheduled+live"), "scheduled")).toBe("live")
  })

  it("maps an empty toggle result and the all chip to all", () => {
    expect(toggleAutorunFilterToken(parseAutorunFilter("scheduled"), "scheduled")).toBe("all")
    expect(toggleAutorunFilterToken(parseAutorunFilter("scheduled+live"), "all")).toBe("all")
  })

  it("leaves all behind when any token chip is picked", () => {
    expect(toggleAutorunFilterToken(parseAutorunFilter("all"), "scheduled")).toBe("scheduled")
    expect(toggleAutorunFilterToken(parseAutorunFilter("all"), "spent")).toBe("spent")
  })
})

describe("shouldAutoExhaustAutoruns", () => {
  it("is true for every filter except all (L285 auto-exhaust)", () => {
    expect(shouldAutoExhaustAutoruns(parseAutorunFilter(undefined))).toBe(true)
    expect(shouldAutoExhaustAutoruns(parseAutorunFilter("spent"))).toBe(true)
    expect(shouldAutoExhaustAutoruns(parseAutorunFilter("all"))).toBe(false)
  })
})
