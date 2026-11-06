import { describe, expect, it } from "vitest"
import type { Profile, ResolverSource } from "@/api/schemas"
import {
  EMPTY_DRAFT,
  changedFields,
  discardSentence,
  draftFrom,
  unsavedList,
  type PresetDraftState,
  type PresetProfileDraft,
} from "./presets-dialog-dirty"

/**
 * The dirty matrix (`PRE-02`, `FLW-07`), read as a table: which typed change
 * makes which form dirty, and what the prompt then says.
 *
 * This module is the only place the dialog decides whether closing would throw
 * work away, so these cases are the contract every close path inherits.
 */

const PROFILE: Profile = {
  id: 1,
  name: "F1 Weekend",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "http://sky.example/playlist.m3u8" },
  retry_mode: "none",
  retry_config: {},
  fallback_chain: [{ resolver_id: 2 }],
}

const SOURCE: ResolverSource = {
  id: 9,
  name: "Sky Sports",
  resolver_id: 1,
  resolver_config: { url: "http://sky.example/playlist.m3u8" },
}

function state(profile: Partial<PresetProfileDraft> = {}): PresetDraftState {
  const base = draftFrom(PROFILE, SOURCE)
  return { ...base, profile: { ...base.profile, ...profile } }
}

function labels(current: PresetDraftState, initial = draftFrom(PROFILE, SOURCE)): string[] {
  return changedFields(initial, current).map((change) => change.label)
}

describe("draftFrom", () => {
  it("starts an empty form when the dialog creates rather than edits", () => {
    expect(draftFrom(null, null)).toEqual(EMPTY_DRAFT)
  })

  it("reads the profile as strings and the chain as normalised rungs", () => {
    const draft = draftFrom(PROFILE, null)
    expect(draft.profile.engineId).toBe("1")
    expect(draft.profile.resolverId).toBe("1")
    expect(draft.profile.retryMode).toBe("none")
    expect(draft.profile.chain).toEqual([{ resolver_id: 2 }])
  })

  it("keeps a saved source's config on the source half only", () => {
    const draft = draftFrom(null, SOURCE)
    expect(draft.source).toEqual({
      name: "Sky Sports",
      resolverId: "1",
      resolverConfig: { url: "http://sky.example/playlist.m3u8" },
    })
    expect(draft.profile).toEqual(EMPTY_DRAFT.profile)
  })
})

describe("changedFields", () => {
  it("finds nothing on an untouched dialog, which is what makes close silent", () => {
    expect(changedFields(draftFrom(PROFILE, SOURCE), draftFrom(PROFILE, SOURCE))).toEqual([])
    expect(changedFields(EMPTY_DRAFT, EMPTY_DRAFT)).toEqual([])
  })

  it.each([
    ["the name", { name: "Nightly news" }],
    ["the engine", { engineId: "2" }],
    ["the resolver", { resolverId: "3" }],
    ["the resolver config", { resolverConfig: { url: "http://other/playlist.m3u8" } }],
    ["the retry mode", { retryMode: "quick" }],
    ["the retry config", { retryConfig: { attempts: 3 } }],
    ["the fallback chain", { chain: [{ resolver_id: 2 }, { engine_id: 3 }] }],
  ])("a typed %s is dirty work", (label, patch) => {
    expect(labels(state(patch as Partial<PresetProfileDraft>))).toEqual([label])
  })

  it("treats a staged chain as work, and clearing a saved one as work too", () => {
    expect(labels(state({ chain: [] }))).toEqual(["the fallback chain"])
    expect(labels(state({ chain: [{ resolver_id: 2 }, { profile_id: 4 }] }))).toEqual([
      "the fallback chain",
    ])
  })

  it("does not care about JSON key order in a config", () => {
    const initial = state({ resolverConfig: { url: "a", quality: "best" } })
    const current = state({ resolverConfig: { quality: "best", url: "a" } })
    expect(changedFields(initial, current)).toEqual([])
  })

  it("counts access grants only when they were actually made", () => {
    const current: PresetDraftState = {
      ...EMPTY_DRAFT,
      access: { grants: { EDIT: ["kyros"] } },
    }
    expect(changedFields(EMPTY_DRAFT, current)).toEqual([
      { form: "access", label: "the access grants" },
    ])
  })

  it("names the same idea once when both forms carry it", () => {
    const current: PresetDraftState = {
      ...draftFrom(PROFILE, SOURCE),
      profile: { ...draftFrom(PROFILE, SOURCE).profile, resolverId: "4" },
      source: { ...draftFrom(PROFILE, SOURCE).source, resolverId: "4" },
    }
    expect(changedFields(draftFrom(PROFILE, SOURCE), current)).toEqual([
      { form: "profile", label: "the resolver" },
    ])
  })

  it("keeps the form each change belongs to, so switching tabs knows what it loses", () => {
    const current: PresetDraftState = {
      ...draftFrom(PROFILE, SOURCE),
      source: { ...draftFrom(PROFILE, SOURCE).source, name: "Sky backup" },
    }
    expect(changedFields(draftFrom(PROFILE, SOURCE), current)).toEqual([
      { form: "source", label: "the name" },
    ])
  })

  it("reads the whole matrix in form order, not keystroke order", () => {
    const current = state({
      chain: [{ resolver_id: 5 }],
      retryMode: "quick",
      name: "Nightly news",
      engineId: "2",
    })
    expect(labels(current)).toEqual([
      "the name",
      "the engine",
      "the retry mode",
      "the fallback chain",
    ])
  })
})

describe("the sentence a close prompt says", () => {
  const one = [{ form: "profile", label: "the name" }] as const
  const three = [
    { form: "profile", label: "the name" },
    { form: "profile", label: "the retry mode" },
    { form: "profile", label: "the fallback chain" },
  ] as const

  it("joins one, two and three things the way a person reads them", () => {
    expect(unsavedList(one)).toBe("the name")
    expect(unsavedList([one[0], { form: "profile", label: "the engine" }])).toBe(
      "the name and the engine",
    )
    expect(unsavedList(three)).toBe("the name, the retry mode and the fallback chain")
    expect(unsavedList([])).toBe("")
  })

  it("says what closing discards, and to whom", () => {
    expect(discardSentence(one, "profile", "close")).toBe(
      "Unsaved: the name. Closing this profile discards it.",
    )
    expect(discardSentence(three, "source", "close")).toBe(
      "Unsaved: the name, the retry mode and the fallback chain. Closing this source discards them.",
    )
  })

  it("says what switching forms discards, without naming a close", () => {
    expect(discardSentence(one, "profile", "switch")).toBe(
      "Unsaved: the name. Switching to the other form discards it.",
    )
    expect(discardSentence(three, "profile", "switch")).toContain("discards them.")
  })
})
