import { describe, expect, it } from "vitest"
import {
  fallbackSourceLabel,
  inheritedChainHint,
  planEntryLabel,
  sourceKey,
} from "./fallback-sources"

const resolvers: Record<number, string> = { 1: "Direct", 2: "daddylive" }
const resolverName = (id: number): string => resolvers[id] ?? `#${id}`

const sources = [
  {
    id: 7,
    name: "Sky Sports",
    resolver_id: 1,
    resolver_config: { channel: "premium9" },
  },
]

describe("sourceKey", () => {
  it("distinguishes the same resolver with a different config", () => {
    const a = sourceKey({ resolver_id: 1, resolver_config: { channel: "one" } })
    const b = sourceKey({ resolver_id: 1, resolver_config: { channel: "two" } })
    const c = sourceKey({ resolver_id: 1, resolver_config: { channel: "one" } })
    expect(a).not.toBe(b)
    expect(a).toBe(c)
  })

  it("treats a missing config as empty", () => {
    expect(sourceKey({ resolver_id: 3 })).toBe(sourceKey({ resolver_id: 3, resolver_config: {} }))
  })
})

describe("fallbackSourceLabel", () => {
  it("prefers the saved source the rung matches", () => {
    expect(
      fallbackSourceLabel(
        { resolver_id: 1, resolver_config: { channel: "premium9" } },
        resolverName,
        sources,
      ),
    ).toBe("Sky Sports")
  })

  it("names an unsaved rung by its resolver and a short config summary", () => {
    expect(
      fallbackSourceLabel(
        { resolver_id: 2, resolver_config: { kind: "tvnow", ref: "60" } },
        resolverName,
      ),
    ).toBe("daddylive · kind=tvnow · ref=60")
  })

  it("names a rung with no config by its resolver alone", () => {
    expect(fallbackSourceLabel({ resolver_id: 2 }, resolverName)).toBe("daddylive")
  })
})

describe("planEntryLabel", () => {
  const asProfile = (id: number) => `profile ${id}`
  const asResolver = (id: number) => resolverName(id)

  it("names a profile rung", () => {
    expect(planEntryLabel(3, asProfile, asResolver)).toBe("profile 3")
  })

  it("names a source rung", () => {
    expect(
      planEntryLabel({ resolver_id: 1, resolver_config: { channel: "premium9" } }, asProfile, asResolver),
    ).toBe("Direct · channel=premium9")
  })

  it("renders the run's own capture as a dash", () => {
    expect(planEntryLabel(null, asProfile, asResolver)).toBe("—")
  })

  it("refuses a record it cannot name", () => {
    expect(planEntryLabel({ nope: true }, asProfile, asResolver)).toBe("—")
  })
})

describe("inheritedChainHint", () => {
  it("says nothing when the profile brings no sources", () => {
    expect(inheritedChainHint([])).toBeNull()
    expect(inheritedChainHint(undefined)).toBeNull()
    expect(inheritedChainHint(null)).toBeNull()
  })

  it("counts one source in the singular", () => {
    expect(inheritedChainHint([{ resolver_id: 1 }])).toBe(
      "Also inherits 1 source fallback from the profile.",
    )
  })

  it("counts a chain in the plural", () => {
    expect(inheritedChainHint([{ resolver_id: 1 }, { resolver_id: 2 }])).toBe(
      "Also inherits 2 source fallbacks from the profile.",
    )
  })
})
