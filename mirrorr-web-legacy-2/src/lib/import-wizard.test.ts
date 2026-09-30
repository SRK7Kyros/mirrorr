/**
 * Import wizard pure logic — V10 (spec L347-L362, plan todo 22).
 *
 * Pins: the client-side guards (parse, version, >500), the validate-report
 * badge derivation for every issue problem, the auto-rename preview, the
 * mapping/profile-missing/engine-override requirement derivations, and the
 * four-step state machine transitions.
 */
import { describe, expect, it } from "vitest"
import {
  INVALID_BUNDLE_MESSAGE,
  INVALID_JSON_MESSAGE,
  ISSUE_BADGE_LABELS,
  MAX_BUNDLE_ITEMS,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_VERSION_MESSAGE,
  badgeForItem,
  engineOverrideRequirements,
  initialWizardState,
  mappingRequirements,
  parseBundleText,
  profileMissingRequirements,
  renamePreview,
  wizardReducer,
  type WizardState,
} from "@/lib/import-wizard"
import {
  bundleSchema,
  validateReportSchema,
  type Bundle,
  type ValidateItem,
  type ValidateReport,
} from "@/lib/schemas/import-export"

function bundle(patch: Partial<Bundle> = {}): Bundle {
  return bundleSchema.parse({ version: 1, profiles: [], autoruns: [], ...patch })
}

function item(patch: Partial<ValidateItem> = {}): ValidateItem {
  return { name: "p", valid: true, issues: [], ...patch }
}

function report(patch: Partial<ValidateReport> = {}): ValidateReport {
  return validateReportSchema.parse({ valid: true, profiles: [], autoruns: [], ...patch })
}

function state(patch: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState, step: "resolve", bundle: bundle(), report: report(), ...patch }
}

const NOT_INSTALLED_ENGINE = {
  problem: "not_installed",
  field: "engine",
  bundled: { name: "engine_x", origin_hash: "deadbeef" },
  alternatives: [{ id: 4, name: "yt_dlp_piped", origin_hash: "6e57" }],
}

describe("parseBundleText guards", () => {
  it("returns the parsed bundle for a version-1 file", () => {
    const result = parseBundleText(JSON.stringify({ version: 1, profiles: [] }))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bundle.autoruns).toEqual([])
  })

  it("rejects malformed JSON with the clear parse message", () => {
    const result = parseBundleText("{ not json")

    expect(result).toEqual({ ok: false, message: INVALID_JSON_MESSAGE })
  })

  it("rejects a version-2 bundle with 'Unsupported bundle version'", () => {
    const result = parseBundleText(JSON.stringify({ version: 2, profiles: [] }))

    expect(result).toEqual({ ok: false, message: UNSUPPORTED_VERSION_MESSAGE })
  })

  it("rejects a missing version with the same unsupported message", () => {
    const result = parseBundleText(JSON.stringify({ profiles: [] }))

    expect(result).toEqual({ ok: false, message: UNSUPPORTED_VERSION_MESSAGE })
  })

  it("rejects a version-1 file whose shape is not a bundle", () => {
    const result = parseBundleText(JSON.stringify({ version: 1, profiles: "nope" }))

    expect(result).toEqual({ ok: false, message: INVALID_BUNDLE_MESSAGE })
  })

  it("rejects 501 profiles with 'Bundle exceeds 500 items'", () => {
    const profiles = Array.from({ length: MAX_BUNDLE_ITEMS + 1 }, (_, index) => ({ name: `p${index}` }))
    const result = parseBundleText(JSON.stringify({ version: 1, profiles }))

    expect(result).toEqual({ ok: false, message: TOO_LARGE_MESSAGE })
  })

  it("rejects 501 autoruns with the same message", () => {
    const autoruns = Array.from({ length: MAX_BUNDLE_ITEMS + 1 }, (_, index) => ({ user_friendly_name: `a${index}` }))
    const result = parseBundleText(JSON.stringify({ version: 1, profiles: [], autoruns }))

    expect(result).toEqual({ ok: false, message: TOO_LARGE_MESSAGE })
  })

  it("accepts exactly 500 items (the guard is strictly greater-than)", () => {
    const profiles = Array.from({ length: MAX_BUNDLE_ITEMS }, (_, index) => ({ name: `p${index}` }))
    const result = parseBundleText(JSON.stringify({ version: 1, profiles }))

    expect(result.ok).toBe(true)
  })
})

describe("badgeForItem", () => {
  it("renders Ready when the item has no issues", () => {
    expect(badgeForItem(item())).toEqual({ key: "ready", label: "Ready" })
  })

  it("renders 'Skip — already imported' for already_exists", () => {
    expect(badgeForItem(item({ issues: [{ problem: "already_exists", existing_id: 1 }] }))).toEqual({
      key: "skip",
      label: "Skip — already imported",
    })
  })

  it("renders 'Needs mapping' for not_installed", () => {
    expect(badgeForItem(item({ issues: [{ problem: "not_installed" }] }))).toEqual({
      key: "mapping",
      label: "Needs mapping",
    })
  })

  it("renders 'Needs mapping' for hash_mismatch", () => {
    expect(badgeForItem(item({ issues: [{ problem: "hash_mismatch" }] }))).toEqual({
      key: "mapping",
      label: "Needs mapping",
    })
  })

  it("renders Conflict for name_conflict", () => {
    expect(badgeForItem(item({ issues: [{ problem: "name_conflict" }] })).key).toBe("conflict")
  })

  it("renders Conflict for profile_missing", () => {
    expect(badgeForItem(item({ issues: [{ problem: "profile_missing" }] })).key).toBe("conflict")
  })

  it("renders Conflict for engine_override", () => {
    expect(badgeForItem(item({ issues: [{ problem: "engine_override" }] })).key).toBe("conflict")
  })

  it("renders Conflict for an unknown issue problem", () => {
    expect(badgeForItem(item({ issues: [{ problem: "future_problem" }] })).key).toBe("conflict")
  })

  it("prefers Needs mapping when an item carries both a plugin and a conflict issue", () => {
    const mixed = item({
      valid: false,
      issues: [{ problem: "name_conflict", existing_id: 2 }, { problem: "not_installed", field: "engine" }],
    })

    expect(badgeForItem(mixed).label).toBe("Needs mapping")
  })

  it("exposes the four spec labels verbatim", () => {
    expect(ISSUE_BADGE_LABELS).toEqual({
      ready: "Ready",
      skip: "Skip — already imported",
      mapping: "Needs mapping",
      conflict: "Conflict",
    })
  })
})

describe("renamePreview", () => {
  it("previews name_2 when the name is taken once", () => {
    expect(renamePreview("p2", ["p2"])).toBe("p2_2")
  })

  it("previews name_3 when name and name_2 are taken", () => {
    expect(renamePreview("p2", ["p2", "p2_2"])).toBe("p2_3")
  })

  it("skips reserved names already previewed in the same batch", () => {
    expect(renamePreview("p2", ["p2"], ["p2_2"])).toBe("p2_3")
  })

  it("returns the name unchanged when it is not taken", () => {
    expect(renamePreview("p2", ["other"])).toBe("p2")
  })
})

describe("mappingRequirements", () => {
  it("builds one requirement per not_installed plugin issue", () => {
    const requirements = mappingRequirements(
      report({ profiles: [{ name: "p-missing-eng", valid: false, issues: [NOT_INSTALLED_ENGINE] }] }),
    )

    expect(requirements).toEqual([
      {
        key: "engine:deadbeef",
        field: "engine",
        pluginType: "engine",
        originHash: "deadbeef",
        bundledName: "engine_x",
        itemName: "p-missing-eng",
        defaultPluginId: null,
      },
    ])
  })

  it("defaults a hash_mismatch to the installed plugin the report names", () => {
    const requirements = mappingRequirements(
      report({
        profiles: [
          {
            name: "p2",
            valid: false,
            issues: [
              {
                problem: "hash_mismatch",
                field: "resolver",
                bundled: { name: "static", origin_hash: "old" },
                installed: { id: 3, name: "static", origin_hash: "new" },
              },
            ],
          },
        ],
      }),
    )

    expect(requirements[0]).toMatchObject({
      key: "resolver:old",
      pluginType: "resolver",
      defaultPluginId: 3,
    })
  })

  it("covers autorun engine issues and ignores non-plugin issues", () => {
    const requirements = mappingRequirements(
      report({
        profiles: [{ name: "p2", valid: true, issues: [{ problem: "already_exists" }, { problem: "name_conflict" }] }],
        autoruns: [{ name: "t2", valid: false, issues: [NOT_INSTALLED_ENGINE] }],
      }),
    )

    expect(requirements).toHaveLength(1)
    expect(requirements[0]?.itemName).toBe("t2")
  })
})

describe("profileMissingRequirements", () => {
  it("collects autoruns whose profile is absent from the bundle", () => {
    const requirements = profileMissingRequirements(
      report({ autoruns: [{ name: "t2", valid: false, issues: [{ problem: "profile_missing", profile_name: "p-gone" }] }] }),
    )

    expect(requirements).toEqual([{ autorunName: "t2", profileName: "p-gone" }])
  })
})

describe("engineOverrideRequirements", () => {
  it("collects autorun entries that carry an inline engine_override", () => {
    const requirements = engineOverrideRequirements(
      bundle({
        autoruns: [
          {
            user_friendly_name: "t2",
            profile_name: "p2",
            profile: { name: "p2" },
            engine_override: { name: "yt_dlp_piped", origin_hash: "abc" },
          },
        ],
      }),
    )

    expect(requirements).toEqual([{ autorunName: "t2", engineName: "yt_dlp_piped" }])
  })
})

describe("wizardReducer", () => {
  it("starts on the choose step with nothing loaded", () => {
    expect(initialWizardState.step).toBe("choose")
    expect(initialWizardState.bundle).toBeNull()
    expect(initialWizardState.guardError).toBeNull()
  })

  it("stores a parsed bundle after a successful pick", () => {
    const next = wizardReducer(initialWizardState, {
      type: "file-parsed",
      fileName: "bundle.json",
      bundle: bundle(),
    })

    expect(next.fileName).toBe("bundle.json")
    expect(next.bundle).not.toBeNull()
    expect(next.step).toBe("choose")
  })

  it("records a guard failure and clears any previous bundle", () => {
    const next = wizardReducer(state({ bundle: bundle() }), {
      type: "file-rejected",
      message: UNSUPPORTED_VERSION_MESSAGE,
    })

    expect(next.guardError).toBe(UNSUPPORTED_VERSION_MESSAGE)
    expect(next.bundle).toBeNull()
    expect(next.report).toBeNull()
  })

  it("moves to review when validation succeeds", () => {
    const next = wizardReducer(initialWizardState, {
      type: "validation-succeeded",
      report: report({ profiles: [item()] }),
    })

    expect(next.step).toBe("review")
    expect(next.report?.profiles).toHaveLength(1)
    expect(next.status).toBe("ready")
  })

  it("steps review → resolve → back to review → back to choose", () => {
    const review = state({ step: "review" })
    const resolve = wizardReducer(review, { type: "next" })
    expect(resolve.step).toBe("resolve")

    expect(wizardReducer(resolve, { type: "back" }).step).toBe("review")
    expect(wizardReducer(review, { type: "back" }).step).toBe("choose")
  })

  it("does not advance from choose before a bundle is parsed", () => {
    expect(wizardReducer(initialWizardState, { type: "next" }).step).toBe("choose")
  })

  it("records a mapping selection by requirement key", () => {
    const next = wizardReducer(state(), { type: "mapping-changed", key: "engine:deadbeef", pluginId: 4 })

    expect(next.mappings).toEqual({ "engine:deadbeef": 4 })
  })

  it("stores both profile_missing resolutions", () => {
    const bound = wizardReducer(state(), {
      type: "profile-missing-changed",
      autorunName: "t2",
      resolution: { kind: "bind", profileName: "p9" },
    })
    const inline = wizardReducer(state(), {
      type: "profile-missing-changed",
      autorunName: "t2",
      resolution: { kind: "inline" },
    })

    expect(bound.profileMissing.t2).toEqual({ kind: "bind", profileName: "p9" })
    expect(inline.profileMissing.t2).toEqual({ kind: "inline" })
  })

  it("stores both engine_override resolutions", () => {
    const inherited = wizardReducer(state(), {
      type: "engine-override-changed",
      autorunName: "t2",
      resolution: "inherit",
    })

    expect(inherited.engineOverrides.t2).toBe("inherit")
  })

  it("adds and removes include toggles from the excluded name lists", () => {
    const excluded = wizardReducer(state(), {
      type: "include-toggled",
      kind: "profile",
      name: "p2",
      included: false,
    })
    expect(excluded.excludedProfiles).toEqual(["p2"])

    const autorunExcluded = wizardReducer(excluded, {
      type: "include-toggled",
      kind: "autorun",
      name: "t2",
      included: false,
    })
    expect(autorunExcluded.excludedAutoruns).toEqual(["t2"])

    const reIncluded = wizardReducer(autorunExcluded, {
      type: "include-toggled",
      kind: "autorun",
      name: "t2",
      included: true,
    })
    expect(reIncluded.excludedAutoruns).toEqual([])
  })

  it("moves to the apply step with the summary on success", () => {
    const next = wizardReducer(state({ status: "applying" }), {
      type: "apply-succeeded",
      summary: { profiles_created: 2, profiles_skipped: 0, autoruns_created: 1 },
    })

    expect(next.step).toBe("apply")
    expect(next.status).toBe("applied")
    expect(next.summary?.profiles_created).toBe(2)
  })

  it("returns to the resolve step with the server detail on failure", () => {
    const next = wizardReducer(state({ step: "resolve", status: "applying" }), {
      type: "apply-failed",
      message: "Cannot resolve engine for profile 'p2'",
    })

    expect(next.step).toBe("resolve")
    expect(next.status).toBe("ready")
    expect(next.applyError).toBe("Cannot resolve engine for profile 'p2'")
  })

  it("resets to the initial state", () => {
    expect(wizardReducer(state({ applyError: "x", step: "apply" }), { type: "reset" })).toEqual(initialWizardState)
  })
})
