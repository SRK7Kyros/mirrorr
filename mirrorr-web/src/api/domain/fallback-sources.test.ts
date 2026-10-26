import { describe, expect, it } from "vitest"
import {
  chainProblem,
  chainProblemSentence,
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

  it("sees one config however its keys were filled in", () => {
    // The server sorts keys, so the client must not call these two sources different.
    expect(
      sourceKey({ resolver_id: 1, resolver_config: { kind: "channel", ref: "60" } }),
    ).toBe(sourceKey({ resolver_id: 1, resolver_config: { ref: "60", kind: "channel" } }))
  })

  it("sorts nested configs too", () => {
    expect(
      sourceKey({ resolver_id: 1, resolver_config: { opts: { b: 1, a: 2 }, z: true } }),
    ).toBe(sourceKey({ resolver_id: 1, resolver_config: { z: true, opts: { a: 2, b: 1 } } }))
  })
})

describe("chainProblem", () => {
  const primary = { resolver_id: 1, resolver_config: { channel: "premium9" } }

  it("passes a chain the server would accept", () => {
    expect(
      chainProblem(
        [
          { resolver_id: 1, resolver_config: { channel: "premium60" } },
          { resolver_id: 2, resolver_config: { kind: "channel", ref: "60" } },
        ],
        primary,
      ),
    ).toBeNull()
  })

  it("passes an empty chain", () => {
    expect(chainProblem([], primary)).toBeNull()
  })

  it("names a rung that repeats the run's own source", () => {
    expect(
      chainProblem(
        [
          { resolver_id: 2, resolver_config: { ref: "60" } },
          { resolver_id: 1, resolver_config: { channel: "premium9" } },
        ],
        primary,
      ),
    ).toEqual({ index: 1, kind: "primary" })
  })

  it("catches a repeat once the keys are written the other way round", () => {
    expect(
      chainProblem(
        [{ resolver_id: 1, resolver_config: { ref: "60", kind: "channel" } }],
        { resolver_id: 1, resolver_config: { kind: "channel", ref: "60" } },
      ),
    ).toEqual({ index: 0, kind: "primary" })
  })

  it("names a rung that repeats an earlier one", () => {
    expect(
      chainProblem([
        { resolver_id: 2, resolver_config: { ref: "60" } },
        { resolver_id: 3 },
        { resolver_id: 2, resolver_config: { ref: "60" } },
      ]),
    ).toEqual({ index: 2, kind: "duplicate", first: 0 })
  })

  it("reports the first problem in the chain", () => {
    expect(
      chainProblem(
        [
          { resolver_id: 1, resolver_config: { channel: "premium9" } },
          { resolver_id: 2, resolver_config: { ref: "60" } },
          { resolver_id: 2, resolver_config: { ref: "60" } },
        ],
        primary,
      ),
    ).toEqual({ index: 0, kind: "primary" })
  })

  it("does not mind the primary when the run has none", () => {
    expect(chainProblem([{ resolver_id: 1, resolver_config: { channel: "premium9" } }])).toBeNull()
  })
})

describe("chainProblemSentence", () => {
  it("says which rung is the run's own source", () => {
    expect(chainProblemSentence({ index: 1, kind: "primary" })).toBe(
      "Fallback 2 is the run’s own source — remove it or change that source.",
    )
  })

  it("says which rung is the profile's own source", () => {
    expect(chainProblemSentence({ index: 0, kind: "primary" }, "profile")).toBe(
      "Fallback 1 is the profile’s own source — remove it or change that source.",
    )
  })

  it("names both rungs of a repeat", () => {
    expect(chainProblemSentence({ index: 2, kind: "duplicate", first: 0 })).toBe(
      "Fallback 3 repeats fallback 1 — remove one of them.",
    )
  })
})

describe("fallbackSourceLabel", () => {
  it("matches a saved source whose config keys were written in another order", () => {
    const saved = [
      {
        id: 8,
        name: "Two keys",
        resolver_id: 1,
        resolver_config: { kind: "channel", ref: "60" },
      },
    ]
    expect(
      fallbackSourceLabel({ resolver_id: 1, resolver_config: { ref: "60", kind: "channel" } }, resolverName, saved),
    ).toBe("Two keys")
  })

  it("prefers the saved source the rung matches", () => {
    expect(
      fallbackSourceLabel(
        { resolver_id: 1, resolver_config: { channel: "premium9" } },
        resolverName,
        sources,
      ),
    ).toBe("Sky Sports")
  })

  it("names an unsaved rung by its resolver and a short config summary", () => {    expect(
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
