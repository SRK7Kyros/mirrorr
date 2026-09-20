/**
 * Unit tests for the `?highlight=<id>` search parser (spec L305, L332). The
 * scroll/ring behaviour itself is exercised by the V7/V8 component and
 * Playwright tests.
 */
import { describe, expect, it } from "vitest"
import { parseHighlightSearch } from "@/hooks/use-highlight"

describe("parseHighlightSearch", () => {
  it("parses a numeric id string", () => {
    expect(parseHighlightSearch("12")).toBe(12)
  })

  it("rejects missing, empty, non-numeric and non-positive values", () => {
    expect(parseHighlightSearch(undefined)).toBeUndefined()
    expect(parseHighlightSearch("")).toBeUndefined()
    expect(parseHighlightSearch("abc")).toBeUndefined()
    expect(parseHighlightSearch("0")).toBeUndefined()
    expect(parseHighlightSearch("1.5")).toBeUndefined()
  })
})
