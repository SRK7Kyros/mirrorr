import { describe, expect, it } from "vitest"
import {
  baseCapture,
  captureKey,
  captureLabel,
  catalogNaming,
  chainOf,
  chainProblemSentence,
  chainTitle,
  foldLegacy,
  mapNaming,
  moveRung,
  normaliseRung,
  planLabel,
  profileBase,
  pruneChain,
  resolveChain,
  resolveRung,
  rungChanges,
  rungLabel,
  rungNames,
  sameChain,
  type ChainBase,
  type ChainCatalog,
  type ChainProfile,
  type FallbackRung,
} from "./fallback-chain"

const uk: ChainProfile = {
  id: 1,
  name: "F1 UK",
  default_engine_id: 10,
  resolver_id: 2,
  resolver_config: { kind: "channel", ref: "60" },
  retry_mode: "none",
  retry_config: {},
}

const italy: ChainProfile = {
  id: 2,
  name: "F1 IT",
  default_engine_id: 10,
  resolver_id: 2,
  resolver_config: { kind: "channel", ref: "577" },
  retry_mode: "always",
  retry_config: { count: 3 },
}

const catalog: ChainCatalog = {
  profiles: [uk, italy],
  engines: [
    { id: 10, name: "ffmpeg" },
    { id: 11, name: "streamlink" },
  ],
  resolvers: [
    { id: 2, name: "daddylive", origin: "daddylive", origin_hash: "a" },
    { id: 3, name: "tvnow", origin: "tvnow", origin_hash: "b" },
  ],
  sources: [
    { id: 7, name: "Sky Sports", resolver_id: 2, resolver_config: { kind: "channel", ref: "60" } },
  ],
}

const naming = catalogNaming(catalog)

/** A run's own capture: the UK channel, no profile. */
const base: ChainBase = {
  engine_id: 10,
  resolver_id: 2,
  resolver_config: { kind: "channel", ref: "60" },
  retry_mode: "always",
  retry_config: { delay: 5 },
}

describe("captureKey", () => {
  it("distinguishes the same engine and resolver on a different config", () => {
    const one = captureKey({ engine_id: 10, resolver_id: 2, resolver_config: { ref: "60" } })
    const two = captureKey({ engine_id: 10, resolver_id: 2, resolver_config: { ref: "577" } })
    expect(one).not.toBe(two)
  })

  it("sees one capture however its config keys were filled in", () => {
    expect(
      captureKey({ engine_id: 10, resolver_id: 2, resolver_config: { kind: "channel", ref: "60" } }),
    ).toBe(captureKey({ engine_id: 10, resolver_id: 2, resolver_config: { ref: "60", kind: "channel" } }))
  })

  it("treats a missing config as empty", () => {
    expect(captureKey({ engine_id: 10, resolver_id: 2 })).toBe(
      captureKey({ engine_id: 10, resolver_id: 2, resolver_config: {} }),
    )
  })
})

describe("normaliseRung", () => {
  it("drops a null the way it drops a missing key", () => {
    expect(normaliseRung({ profile_id: 1, engine_id: null, resolver_id: null })).toEqual({
      profile_id: 1,
    })
  })

  it("keeps a config, empty included", () => {
    expect(normaliseRung({ resolver_id: 3, resolver_config: {} })).toEqual({
      resolver_id: 3,
      resolver_config: {},
    })
  })
})

describe("rungNames", () => {
  it("refuses a rung that names nothing", () => {
    expect(rungNames({})).toBe(false)
    expect(rungNames({ profile_id: null, resolver_config: null })).toBe(false)
  })

  it("accepts a rung naming any one thing", () => {
    expect(rungNames({ profile_id: 1 })).toBe(true)
    expect(rungNames({ engine_id: 11 })).toBe(true)
    expect(rungNames({ resolver_id: 3 })).toBe(true)
  })
})

describe("moveRung", () => {
  const chain = [{ profile_id: 1 }, { resolver_id: 2, resolver_config: {} }, { engine_id: 3 }]

  it("moves a rung to the position it was dropped on", () => {
    expect(moveRung(chain, 0, 2)).toEqual([chain[1], chain[2], chain[0]])
    expect(moveRung(chain, 2, 0)).toEqual([chain[2], chain[0], chain[1]])
    expect(moveRung(chain, 1, 2)).toEqual([chain[0], chain[2], chain[1]])
  })

  it("leaves the chain alone when the move goes nowhere", () => {
    expect(moveRung(chain, 1, 1)).toEqual(chain)
    expect(moveRung(chain, 0, 9)).toEqual(chain)
    expect(moveRung(chain, -1, 0)).toEqual(chain)
    expect(moveRung([], 0, 0)).toEqual([])
  })

  it("never mutates the chain it was given", () => {
    const original = [...chain]
    moveRung(chain, 0, 2)
    expect(chain).toEqual(original)
  })
})

describe("foldLegacy", () => {
  it("puts the profile rungs first, the order they always ran in", () => {
    expect(foldLegacy([2], [{ resolver_id: 3, resolver_config: { ref: "x" } }])).toEqual([
      { profile_id: 2 },
      { resolver_id: 3, resolver_config: { ref: "x" } },
    ])
  })

  it("reads nothing from two absent lists", () => {
    expect(foldLegacy(null, undefined)).toEqual([])
  })
})

describe("chainOf", () => {
  it("reads the rungs when there are rungs", () => {
    expect(chainOf({ fallback_chain: [{ profile_id: 2, engine_id: null }] })).toEqual([
      { profile_id: 2 },
    ])
  })

  it("honours an empty chain as no fallbacks", () => {
    expect(chainOf({ fallback_chain: [], fallback_profile_ids: [2] })).toEqual([])
  })

  it("folds the old pair when the row predates rungs", () => {
    expect(
      chainOf({
        fallback_chain: null,
        fallback_profile_ids: [2],
        fallback_sources: [{ resolver_id: 3 }],
      }),
    ).toEqual([{ profile_id: 2 }, { resolver_id: 3 }])
  })
})

describe("baseCapture and profileBase", () => {
  it("fills an inherited retry policy with none", () => {
    expect(
      baseCapture({ engine_id: 10, resolver_id: 2 }).retry_mode,
    ).toBe("none")
  })

  it("takes a profile whole as the capture a chain patches", () => {
    expect(profileBase(italy)).toEqual({
      engine_id: 10,
      resolver_id: 2,
      resolver_config: { kind: "channel", ref: "577" },
      profile_id: 2,
      profile_name: "F1 IT",
      retry_mode: "always",
      retry_config: { count: 3 },
    })
  })
})

describe("resolveRung", () => {
  const own = baseCapture(base)

  it("takes a named profile whole", () => {
    const step = resolveRung({ profile_id: 2 }, own, catalog)
    expect(step.ok).toBe(true)
    if (!step.ok) return
    expect(step.capture).toMatchObject({
      engine_id: 10,
      resolver_id: 2,
      resolver_config: { kind: "channel", ref: "577" },
      profile_id: 2,
      profile_name: "F1 IT",
      retry_mode: "always",
    })
  })

  it("inherits the engine when it only swaps the source", () => {
    const step = resolveRung({ resolver_id: 3 }, own, catalog)
    expect(step.ok).toBe(true)
    if (!step.ok) return
    expect(step.capture.engine_id).toBe(10)
    expect(step.capture.resolver_id).toBe(3)
    expect(step.capture.profile_id).toBeNull()
  })

  it("drops a config when the resolver changes, because a config belongs to its resolver", () => {
    const step = resolveRung({ resolver_id: 3 }, own, catalog)
    expect(step.ok && step.capture.resolver_config).toEqual({})
  })

  it("keeps the config when the rung names the resolver already running", () => {
    const step = resolveRung({ resolver_id: 2, engine_id: 11 }, own, catalog)
    expect(step.ok && step.capture.resolver_config).toEqual({ kind: "channel", ref: "60" })
  })

  it("keeps the retry policy in force for a rung that names no profile", () => {
    const step = resolveRung({ resolver_id: 3 }, own, catalog)
    expect(step.ok && step.capture.retry_mode).toBe("always")
    expect(step.ok && step.capture.retry_config).toEqual({ delay: 5 })
  })

  it("refuses a profile, engine or resolver that is no longer here", () => {
    expect(resolveRung({ profile_id: 99 }, own, catalog)).toEqual({
      ok: false,
      kind: "profile-missing",
    })
    expect(resolveRung({ engine_id: 99 }, own, catalog)).toEqual({
      ok: false,
      kind: "engine-missing",
    })
    expect(resolveRung({ resolver_id: 99 }, own, catalog)).toEqual({
      ok: false,
      kind: "resolver-missing",
    })
  })
})

describe("resolveChain", () => {
  it("runs a chain and reports no problem", () => {
    const chain = resolveChain([{ profile_id: 2 }, { resolver_id: 3 }], base, catalog)
    expect(chain.problem).toBeNull()
    expect(chain.captures).toHaveLength(2)
    expect(chain.steps.map((step) => step.problem)).toEqual([null, null])
  })

  it("patches every rung over the run's own capture, never over the one before it", () => {
    const chain = resolveChain([{ profile_id: 2 }, { resolver_id: 3 }], base, catalog)
    expect(chain.captures).toHaveLength(2)
    // The profile rung brings its own retry policy…
    expect(chain.captures[0].retry_mode).toBe("always")
    expect(chain.captures[0].retry_config).toEqual({ count: 3 })
    // …and the source rung after it takes the run's, not the profile's.
    expect(chain.captures[1].engine_id).toBe(10)
    expect(chain.captures[1].retry_mode).toBe("always")
    expect(chain.captures[1].retry_config).toEqual({ delay: 5 })
    expect(chain.captures[1].resolver_config).toEqual({})
  })

  it("marks a rung that repeats the run's own source as primary", () => {
    const chain = resolveChain(
      [{ resolver_id: 2, resolver_config: { kind: "channel", ref: "60" } }],
      base,
      catalog,
    )
    expect(chain.problem).toEqual({ index: 0, kind: "primary" })
    expect(chain.captures).toEqual([])
  })

  it("marks a rung that repeats an earlier one and names the first", () => {
    const chain = resolveChain([{ resolver_id: 3 }, { resolver_id: 3 }], base, catalog)
    expect(chain.problem).toEqual({ index: 1, kind: "duplicate", first: 0 })
  })

  it("marks a rung that names nothing", () => {
    const chain = resolveChain([{ profile_id: null }], base, catalog)
    expect(chain.problem).toEqual({ index: 0, kind: "empty" })
  })

  it("keeps patching the last capture that stood, not the dropped rung", () => {
    const own: ChainBase = {
      ...base,
      resolver_config: { kind: "channel", ref: "60", label: "UK" },
    }
    const chain = resolveChain(
      [{ profile_id: 1 }, { profile_id: 1 }, { engine_id: 11 }],
      own,
      catalog,
    )
    expect(chain.problem).toEqual({ index: 1, kind: "duplicate", first: 0 })
    const last = chain.steps[2].capture
    expect(last).toMatchObject({
      engine_id: 11,
      resolver_id: 2,
      resolver_config: { kind: "channel", ref: "60" },
    })
  })

  it("shows every problem, not only the first one it hit", () => {
    const chain = resolveChain([{ profile_id: 99 }, { engine_id: 98 }], base, catalog)
    expect(chain.problem).toEqual({ index: 0, kind: "profile-missing" })
    expect(chain.steps.map((step) => step.problem?.kind)).toEqual([
      "profile-missing",
      "engine-missing",
    ])
  })
})

describe("pruneChain", () => {
  it("drops a rung that became a repeat of the run's own capture", () => {
    expect(pruneChain([{ profile_id: 1 }], profileBase(uk), catalog)).toEqual([])
  })

  it("drops a repeat of an earlier rung", () => {
    expect(pruneChain([{ resolver_id: 3 }, { resolver_id: 3 }], base, catalog)).toEqual([
      { resolver_id: 3 },
    ])
  })

  it("keeps a rung it cannot resolve, so the reader is told why", () => {
    const chain = [{ profile_id: 99 }]
    expect(pruneChain(chain, base, catalog)).toEqual(chain)
  })

  it("leaves a runnable chain as it is", () => {
    const chain = [{ profile_id: 2 }, { resolver_id: 3 }]
    expect(sameChain(pruneChain(chain, base, catalog), chain)).toBe(true)
  })
})

describe("sameChain", () => {
  it("ignores the order a config's keys were filled in", () => {
    expect(
      sameChain(
        [{ resolver_id: 2, resolver_config: { kind: "channel", ref: "60" } }],
        [{ resolver_id: 2, resolver_config: { ref: "60", kind: "channel" } }],
      ),
    ).toBe(true)
  })

  it("sees a different order as a different chain", () => {
    expect(sameChain([{ profile_id: 2 }, { resolver_id: 3 }], [{ resolver_id: 3 }, { profile_id: 2 }])).toBe(
      false,
    )
  })
})

describe("naming", () => {
  it("names a rung by what it changes", () => {
    expect(rungLabel({ profile_id: 1 }, naming)).toBe("F1 UK")
    expect(rungLabel({ engine_id: 11 }, naming)).toBe("streamlink")
    expect(rungLabel({ resolver_id: 3 }, naming)).toBe("tvnow")
    expect(rungLabel({ profile_id: 2, resolver_id: 3, engine_id: 11 }, naming)).toBe(
      "F1 IT · tvnow · streamlink",
    )
  })

  it("says so when a rung names nothing", () => {
    expect(rungLabel({}, naming)).toBe("Nothing")
  })

  it("prefers the saved source a rung's config matches", () => {
    expect(rungLabel({ resolver_id: 2, resolver_config: { ref: "60", kind: "channel" } }, naming)).toBe(
      "Sky Sports",
    )
  })

  it("names a capture by the profile it takes and the source it runs", () => {
    const chain = resolveChain([{ profile_id: 2 }], base, catalog)
    expect(captureLabel(chain.captures[0], base, naming)).toBe(
      "F1 IT · daddylive · kind=channel · ref=577",
    )
  })

  it("names the engine only when it is not the run's own", () => {
    const chain = resolveChain([{ resolver_id: 3, engine_id: 11 }], base, catalog)
    expect(captureLabel(chain.captures[0], base, naming)).toBe("tvnow · streamlink")
  })

  it("spells a whole chain on one line", () => {
    expect(chainTitle([{ profile_id: 1 }, { engine_id: 11 }], naming)).toBe("F1 UK → streamlink")
  })

  it("falls back to a readable placeholder for a missing row", () => {
    const sparse = mapNaming({ engines: new Map(), resolvers: new Map(), profiles: new Map() })
    expect(rungLabel({ profile_id: 4, engine_id: 5, resolver_id: 6 }, sparse)).toBe(
      "Profile 4 · Resolver 6 · Engine 5",
    )
  })
})

describe("planLabel", () => {
  it("names the run's own capture for a null entry", () => {
    expect(planLabel(null, base, naming)).toBe("Sky Sports")
  })

  it("names a bare profile id", () => {
    expect(planLabel(2, base, naming)).toBe("F1 IT")
  })

  it("names a resolved capture", () => {
    expect(
      planLabel(
        {
          engine_id: 10,
          resolver_id: 2,
          resolver_config: { kind: "channel", ref: "577" },
          profile_id: 2,
          profile_name: "F1 IT",
        },
        base,
        naming,
      ),
    ).toBe("F1 IT · daddylive · kind=channel · ref=577")
  })

  it("names the engine of a capture that changes it", () => {
    expect(
      planLabel(
        {
          engine_id: 11,
          resolver_id: 3,
          resolver_config: {},
          profile_id: null,
          profile_name: "",
        },
        base,
        naming,
      ),
    ).toBe("tvnow · streamlink")
  })

  it("reads a shape an older build stored as the run's own capture", () => {
    expect(planLabel({}, base, naming)).toBe("daddylive")
  })

  it("refuses to invent a label for a value that is not a plan entry", () => {
    expect(planLabel("nonsense", base, naming)).toBe("—")
  })
})

describe("rungChanges", () => {
  const own = baseCapture(base)

  function changesOf(rung: FallbackRung) {
    const resolved = resolveRung(rung, own, catalog)
    expect(resolved.ok).toBe(true)
    return resolved.ok ? rungChanges(resolved.capture, own, naming) : []
  }

  it("names the profile a rung takes, and what it takes it from", () => {
    expect(changesOf({ profile_id: 2 })).toEqual([
      { key: "profile", label: "Profile", from: "", to: "F1 IT" },
      {
        key: "source",
        label: "Source",
        from: "Sky Sports",
        to: "daddylive · kind=channel · ref=577",
      },
    ])
  })

  it("names only the engine when that is all the rung changes", () => {
    expect(changesOf({ engine_id: 11 })).toEqual([
      { key: "engine", label: "Engine", from: "ffmpeg", to: "streamlink" },
    ])
  })

  it("names only the source when the rung keeps the run's own engine", () => {
    expect(changesOf({ resolver_id: 3 })).toEqual([
      { key: "source", label: "Source", from: "Sky Sports", to: "tvnow" },
    ])
  })

  it("reports nothing for a rung that changes nothing", () => {
    expect(changesOf({ engine_id: 10 })).toEqual([])
  })

  it("replaces the profile the capture it patches already runs", () => {
    const fromProfile = baseCapture({
      engine_id: 10,
      resolver_id: 2,
      resolver_config: { kind: "channel", ref: "60" },
      profile_id: 1,
      profile_name: "F1 UK",
    })
    const resolved = resolveRung({ profile_id: 2 }, fromProfile, catalog)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(rungChanges(resolved.capture, fromProfile, naming)[0]).toEqual({
      key: "profile",
      label: "Profile",
      from: "F1 UK",
      to: "F1 IT",
    })
  })

  it("takes no profile away when a rung names none", () => {
    const fromProfile = baseCapture({
      engine_id: 10,
      resolver_id: 2,
      resolver_config: { kind: "channel", ref: "60" },
      profile_id: 1,
      profile_name: "F1 UK",
    })
    const resolved = resolveRung({ resolver_id: 3 }, fromProfile, catalog)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(rungChanges(resolved.capture, fromProfile, naming).map((change) => change.key)).toEqual([
      "source",
    ])
  })
})

describe("chainProblemSentence", () => {
  it("names the rung and what to do about it", () => {
    expect(chainProblemSentence({ index: 0, kind: "primary" })).toBe(
      "Fallback 1 is the run’s own source — change what it names.",
    )
    expect(chainProblemSentence({ index: 1, kind: "primary" }, "profile")).toBe(
      "Fallback 2 is the profile’s own source — change what it names.",
    )
    expect(chainProblemSentence({ index: 1, kind: "duplicate", first: 0 })).toBe(
      "Fallback 2 repeats fallback 1 — remove one of them.",
    )
    expect(chainProblemSentence({ index: 2, kind: "empty" })).toBe(
      "Fallback 3 names nothing to run — name a profile, an engine or a source.",
    )
    expect(chainProblemSentence({ index: 0, kind: "profile-missing" })).toBe(
      "Fallback 1 names a profile that is no longer here.",
    )
    expect(chainProblemSentence({ index: 0, kind: "engine-missing" })).toBe(
      "Fallback 1 names an engine that is no longer here.",
    )
    expect(chainProblemSentence({ index: 0, kind: "resolver-missing" })).toBe(
      "Fallback 1 names a resolver that is no longer here.",
    )
  })
})
