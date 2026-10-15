import { describe, expect, it } from "vitest"
import {
  DEFAULT_FILTER,
  matchesFilter,
  parseFilter,
  parseFilterTokens,
  shouldAutoExhaust,
} from "./filter-grammar"

describe("parseFilterTokens", () => {
  it("splits + -joined tokens and dedupes", () => {
    expect(parseFilterTokens("scheduled+live+live").tokens).toEqual(["scheduled", "live"])
  })

  it("drops unknown tokens", () => {
    const { tokens, dropped } = parseFilterTokens("scheduled+bogus+live")
    expect(tokens).toEqual(["scheduled", "live"])
    expect(dropped).toEqual(["bogus"])
  })
})

describe("parseFilter", () => {
  it("defaults to the all view when the param is absent", () => {
    expect(parseFilter(null)).toEqual(["all"])
    expect(parseFilter(undefined)).toEqual([...DEFAULT_FILTER])
  })

  it("falls back to all when the param is empty or fully invalid", () => {
    expect(parseFilter("")).toEqual(["all"])
    expect(parseFilter("bogus+nope")).toEqual(["all"])
  })

  it("keeps explicit tokens", () => {
    expect(parseFilter("spent")).toEqual(["spent"])
    expect(parseFilter("all")).toEqual(["all"])
    expect(parseFilter("scheduled+live+spent")).toEqual(["scheduled", "live", "spent"])
  })
})

describe("matchesFilter", () => {
  const run = (status: string, raw: string | null) => matchesFilter(status, parseFilter(raw))

  it("covers the live set", () => {
    expect(run("active", "live")).toBe(true)
    expect(run("recording", "live")).toBe(true)
    expect(run("terminating", "live")).toBe(true)
    expect(run("remuxing", "live")).toBe(true)
    expect(run("finalizing", "live")).toBe(true)
    expect(run("scheduled", "live")).toBe(false)
    expect(run("completed", "live")).toBe(false)
  })

  it("covers the spent set", () => {
    expect(run("completed", "spent")).toBe(true)
    expect(run("failed", "spent")).toBe(true)
    expect(run("active", "spent")).toBe(false)
  })

  it("matches scheduled only", () => {
    expect(run("scheduled", "scheduled")).toBe(true)
    expect(run("active", "scheduled")).toBe(false)
  })

  it("all matches everything including unknown statuses", () => {
    expect(run("scheduled", "all")).toBe(true)
    expect(run("weird", "all")).toBe(true)
  })

  it("default filter = all, so a spent status is in too", () => {
    expect(run("scheduled", null)).toBe(true)
    expect(run("active", null)).toBe(true)
    expect(run("completed", null)).toBe(true)
    expect(run("failed", null)).toBe(true)
  })
})

describe("shouldAutoExhaust", () => {
  it("auto-exhausts for non-all filters only", () => {
    expect(shouldAutoExhaust(parseFilter("scheduled"))).toBe(true)
    expect(shouldAutoExhaust(parseFilter("live+spent"))).toBe(true)
    expect(shouldAutoExhaust(parseFilter("all"))).toBe(false)
    expect(shouldAutoExhaust(parseFilter(""))).toBe(false)
  })
})
