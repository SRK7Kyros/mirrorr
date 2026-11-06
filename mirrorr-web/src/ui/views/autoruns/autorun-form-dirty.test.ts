import { describe, expect, it } from "vitest"
import type { Autorun } from "@/api/schemas"
import {
  changedFields,
  discardSentence,
  draftFrom,
  EMPTY_AUTORUN_DRAFT,
  resolveMode,
  unsavedList,
  type AutorunDraft,
} from "./autorun-form-dirty"
import { catalogBlockReason } from "./autorun-form-catalogs"

const BASE: Autorun = {
  id: 201,
  user_friendly_name: "Nightly news",
  snake_case_name: "nightly-news",
  start_time: "2026-11-07 21:00:00",
  end_time: "2026-11-07 22:00:00",
  status: "scheduled",
  enabled: true,
  engine_id: 1,
  resolver_id: 2,
  resolver_config: { channel: "news" },
  profile_id: 7,
  fallback_chain: [{ profile_id: 8 }],
  recording: true,
  user_id: 1,
  created_at: "2026-11-01 09:00:00",
  updated_at: "2026-11-01 09:00:00",
} as Autorun

function draft(overrides: Partial<AutorunDraft> = {}): AutorunDraft {
  return { ...draftFrom(BASE), ...overrides }
}

describe("an untouched dialog is not dirty", () => {
  it("has nothing to discard on a new autorun", () => {
    expect(changedFields(EMPTY_AUTORUN_DRAFT, EMPTY_AUTORUN_DRAFT)).toEqual([])
  })

  it("has nothing to discard on the row it opened, chain included", () => {
    expect(changedFields(draftFrom(BASE), draft())).toEqual([])
  })
})

describe("what closing would throw away", () => {
  it("names the name and the slug it auto-filled", () => {
    const changes = changedFields(EMPTY_AUTORUN_DRAFT, {
      ...EMPTY_AUTORUN_DRAFT,
      friendly: "Race night",
      slug: "race-night",
    })
    expect(changes.map((change) => change.label)).toEqual(["the name", "the slug"])
  })

  it("counts a staged fallback chain as work", () => {
    const changes = changedFields(draft(), draft({ chain: [{ engine_id: 3 }] }))
    expect(changes.map((change) => change.label)).toEqual(["the fallback chain"])
  })

  it("counts a resolver config edit on its own", () => {
    const changes = changedFields(draft(), draft({ resolverConfig: { channel: "sport" } }))
    expect(changes.map((change) => change.label)).toEqual(["the resolver config"])
  })

  it("counts the window, the recording toggle and the access grants", () => {
    const changes = changedFields(draft(), {
      ...draft(),
      endLocal: "2026-11-07T23:30",
      recording: false,
      access: { users: [1] } as never,
    })
    expect(changes.map((change) => change.label)).toEqual([
      "the end time",
      "the recording setting",
      "the access grants",
    ])
  })

  it("does not call a bare mode switch a change", () => {
    // Choosing the other half of the form changed nothing yet, so there is
    // nothing to lose — the same rule the preset editor applies.
    const changes = changedFields(EMPTY_AUTORUN_DRAFT, {
      ...EMPTY_AUTORUN_DRAFT,
      mode: "custom",
    })
    expect(changes).toEqual([])
  })

  it("counts the half of the form once it can actually run", () => {
    const changes = changedFields(EMPTY_AUTORUN_DRAFT, {
      ...EMPTY_AUTORUN_DRAFT,
      mode: "custom",
      engineId: "1",
      resolverId: "2",
    })
    expect(changes.map((change) => change.label)).toEqual([
      "the start source",
      "the engine",
      "the resolver",
    ])
  })
})

describe("the prompt", () => {
  it("reads as one sentence naming everything unsaved", () => {
    const changes = changedFields(EMPTY_AUTORUN_DRAFT, {
      ...EMPTY_AUTORUN_DRAFT,
      friendly: "Race",
      startLocal: "2026-11-07T21:00",
      endLocal: "2026-11-07T22:00",
    })
    expect(unsavedList(changes)).toBe("the name, the start time and the end time")
    expect(discardSentence(changes)).toBe(
      "Unsaved: the name, the start time and the end time. Closing this autorun discards them.",
    )
  })

  it("says it and them for a single change", () => {
    const changes = changedFields(draft(), draft({ friendly: "Renamed" }))
    expect(discardSentence(changes)).toBe("Unsaved: the name. Closing this autorun discards it.")
  })
})

describe("resolveMode", () => {
  it("shows the profile form while that list is loading or failed", () => {
    expect(resolveMode("auto", "loading", false)).toBe("profile")
    expect(resolveMode("auto", "failed", false)).toBe("profile")
    expect(resolveMode("auto", "ready", false)).toBe("profile")
  })

  it("only falls back to engine + resolver once the server says there are none", () => {
    expect(resolveMode("auto", "empty", false)).toBe("custom")
  })

  it("stops following once an engine and resolver are typed", () => {
    expect(resolveMode("auto", "ready", true)).toBe("custom")
    expect(resolveMode("auto", "failed", true)).toBe("custom")
  })

  it("obeys an explicit choice", () => {
    expect(resolveMode("custom", "ready", false)).toBe("custom")
    expect(resolveMode("profile", "empty", false)).toBe("profile")
  })
})

describe("catalogBlockReason", () => {
  const quiet = {
    profileEmpty: true,
    engineEmpty: true,
    resolverEmpty: true,
    profilesFailed: false,
    enginesFailed: false,
    resolversFailed: false,
  }

  it("names the failed list the save is waiting on", () => {
    expect(catalogBlockReason("profile", { ...quiet, profilesFailed: true })).toBe(
      "The profile list did not load — retry it above before saving.",
    )
    expect(catalogBlockReason("custom", { ...quiet, enginesFailed: true })).toBe(
      "The engine list did not load — retry it above before saving.",
    )
  })

  it("waits for an engine before naming the resolver list", () => {
    expect(
      catalogBlockReason("custom", { ...quiet, resolversFailed: true }),
    ).toBeNull()
    expect(
      catalogBlockReason("custom", {
        ...quiet,
        engineEmpty: false,
        resolverEmpty: true,
        resolversFailed: true,
      }),
    ).toBe("The resolver list did not load — retry it above before saving.")
  })

  it("says nothing once the selection is already filled in", () => {
    expect(
      catalogBlockReason("profile", { ...quiet, profileEmpty: false, profilesFailed: true }),
    ).toBeNull()
  })
})
