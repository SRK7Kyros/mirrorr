import { describe, expect, it } from "vitest"
import { canonicalJson, fallbackSourceLabel, summariseConfig } from "./fallback-sources"

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

describe("canonicalJson", () => {
  it("sees one config however its keys were filled in", () => {
    expect(canonicalJson({ kind: "channel", ref: "60" })).toBe(
      canonicalJson({ ref: "60", kind: "channel" }),
    )
  })

  it("sorts nested configs too", () => {
    expect(canonicalJson({ opts: { b: 1, a: 2 }, z: true })).toBe(
      canonicalJson({ z: true, opts: { a: 2, b: 1 } }),
    )
  })

  it("treats a missing config as empty", () => {
    expect(canonicalJson(undefined)).toBe("{}")
  })
})

describe("summariseConfig", () => {
  it("joins the values that are set", () => {
    expect(summariseConfig({ kind: "channel", ref: "60", empty: "" })).toBe(
      "kind=channel · ref=60",
    )
  })

  it("shortens a long value", () => {
    expect(summariseConfig({ url: "x".repeat(60) })).toBe(`url=${"x".repeat(17)}…`)
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
      fallbackSourceLabel(
        { resolver_id: 1, resolver_config: { ref: "60", kind: "channel" } },
        resolverName,
        saved,
      ),
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
