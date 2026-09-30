/**
 * Deterministic apply-body encoding — spec L359-L362.
 *
 * The wizard posts `{bundle: <edited bundle>, plugin_map, removed_profiles?,
 * removed_autoruns?}`. These tests assert the exact edited entries for both
 * `profile_missing` resolutions and both `engine_override` resolutions, the
 * plugin_map restriction to `not_installed`/`hash_mismatch`, the removed_*
 * rule (only explicitly excluded items), and byte-stable serialization.
 */
import { describe, expect, it } from "vitest"
import {
  applyBody,
  canApply,
  initialWizardState,
  unresolvedCount,
  type WizardState,
} from "@/lib/import-wizard"
import {
  bundleSchema,
  validateReportSchema,
  type Bundle,
  type ValidateReport,
} from "@/lib/schemas/import-export"

const PROFILE_P2 = {
  name: "p2",
  default_engine: { name: "yt_dlp_piped", origin_hash: "6e57" },
  resolver: { name: "static", origin_hash: "f1c2" },
  resolver_config: { url: "https://example.com/a.m3u8" },
  retry_mode: "none",
  retry_config: {},
}

const PROFILE_P3 = {
  ...PROFILE_P2,
  name: "p3",
  resolver_config: { url: "https://example.com/b.m3u8" },
}

const AUTORUN_T2 = {
  user_friendly_name: "t2",
  profile_name: "p2",
  profile: PROFILE_P2,
  start_time: "2050-07-15T15:12:00",
  end_time: "2050-07-15T16:12:00",
  recording: true,
}

const AUTORUN_T3 = {
  user_friendly_name: "t3",
  profile_name: "p-gone",
  profile: { name: "p-gone" },
  start_time: "2050-07-16T15:12:00",
  end_time: "2050-07-16T16:12:00",
  recording: false,
  engine_override: { name: "yt_dlp_piped", origin_hash: "oldengine" },
}

function baseBundle(): Bundle {
  return bundleSchema.parse({ version: 1, profiles: [PROFILE_P2, PROFILE_P3], autoruns: [AUTORUN_T2, AUTORUN_T3] })
}

function cleanReport(): ValidateReport {
  return validateReportSchema.parse({ valid: true, profiles: [], autoruns: [] })
}

function state(patch: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState,
    step: "resolve",
    status: "ready",
    bundle: baseBundle(),
    report: cleanReport(),
    ...patch,
  }
}

function editedAutorun(body: ReturnType<typeof applyBody>, name: string) {
  if (body === null) throw new Error("expected an apply body")
  return body.bundle.autoruns.find((entry) => entry.user_friendly_name === name)
}

describe("applyBody — bundle sent is the edited one", () => {
  it("returns a body with only bundle + plugin_map when nothing was edited", () => {
    const body = applyBody(state())

    expect(body).not.toBeNull()
    expect(Object.keys(body ?? {})).toEqual(["bundle", "plugin_map"])
    expect(body?.bundle).toEqual(baseBundle())
    expect(body?.plugin_map).toEqual({})
  })

  it("never mutates the source bundle", () => {
    const current = state()
    const snapshot = structuredClone(current.bundle)

    applyBody(current)

    expect(current.bundle).toEqual(snapshot)
  })

  it("rewrites profile_name and the embedded profile for a bind resolution", () => {
    const body = applyBody(
      state({ profileMissing: { t3: { kind: "bind", profileName: "p9" } } }),
    )
    const entry = editedAutorun(body, "t3")

    expect(entry).toEqual({ ...AUTORUN_T3, profile_name: "p9", profile: { name: "p9" } })
  })

  it("drops the profile key for an inline resolution and keeps the other fields", () => {
    const body = applyBody(state({ profileMissing: { t3: { kind: "inline" } } }))
    const entry = editedAutorun(body, "t3")

    expect(entry).toBeDefined()
    expect(entry === undefined ? true : "profile" in entry).toBe(false)
    expect(entry).toMatchObject({ user_friendly_name: "t3", profile_name: "p-gone", recording: false })
  })

  it("leaves the entry unchanged when the engine override is kept", () => {
    const body = applyBody(state({ engineOverrides: { t3: "keep" } }))

    expect(editedAutorun(body, "t3")).toEqual(AUTORUN_T3)
  })

  it("removes the inline engine override so the autorun inherits the profile engine", () => {
    const body = applyBody(state({ engineOverrides: { t3: "inherit" } }))
    const entry = editedAutorun(body, "t3")

    expect(entry).toBeDefined()
    expect(entry === undefined ? true : "engine_override" in entry).toBe(false)
    expect(entry?.profile_name).toBe("p-gone")
  })

  it("preserves top-level bundle keys and entry field order", () => {
    const current = state({ bundle: bundleSchema.parse({ ...baseBundle(), exported_at: "2050-01-01T00:00:00" }) })
    const body = applyBody(current)

    expect(body?.bundle.exported_at).toBe("2050-01-01T00:00:00")
    expect(Object.keys(body?.bundle.autoruns[0] ?? {})).toEqual(Object.keys(AUTORUN_T2))
  })
})

describe("applyBody — removed_* arrays", () => {
  it("filters excluded items out of the bundle and lists only their names", () => {
    const body = applyBody(state({ excludedProfiles: ["p3"], excludedAutoruns: ["t2"] }))

    expect(body?.bundle.profiles.map((profile) => profile.name)).toEqual(["p2"])
    expect(body?.bundle.autoruns.map((autorun) => autorun.user_friendly_name)).toEqual(["t3"])
    expect(body?.removed_profiles).toEqual(["p3"])
    expect(body?.removed_autoruns).toEqual(["t2"])
  })

  it("omits both removed_* keys when nothing was excluded", () => {
    const body = applyBody(state())

    expect(body === null ? true : "removed_profiles" in body).toBe(false)
    expect(body === null ? true : "removed_autoruns" in body).toBe(false)
  })
})

describe("applyBody — plugin_map", () => {
  const mappingReport = validateReportSchema.parse({
    valid: false,
    profiles: [
      {
        name: "p2",
        valid: false,
        issues: [
          {
            problem: "not_installed",
            field: "engine",
            bundled: { name: "engine_x", origin_hash: "bbbb" },
          },
          {
            problem: "hash_mismatch",
            field: "resolver",
            bundled: { name: "static", origin_hash: "aaaa" },
            installed: { id: 2, name: "static", origin_hash: "f1c2" },
          },
        ],
      },
    ],
    autoruns: [{ name: "t2", valid: true, issues: [{ problem: "already_exists", existing_id: 1 }] }],
  })

  it("emits one sorted entry per mapped not_installed/hash_mismatch hash", () => {
    const body = applyBody(
      state({ report: mappingReport, mappings: { "resolver:aaaa": 2, "engine:bbbb": 4 } }),
    )

    expect(body?.plugin_map).toEqual({
      aaaa: { type: "resolver", id: 2 },
      bbbb: { type: "engine", id: 4 },
    })
    expect(Object.keys(body?.plugin_map ?? {})).toEqual(["aaaa", "bbbb"])
  })

  it("ignores mappings that no not_installed/hash_mismatch issue asked for", () => {
    const body = applyBody(state({ report: mappingReport, mappings: { "engine:unrelated": 9 } }))

    expect(body?.plugin_map).toEqual({})
  })

  it("serializes byte-identically regardless of mappings insertion order", () => {
    const forward = applyBody(
      state({ report: mappingReport, mappings: { "engine:bbbb": 4, "resolver:aaaa": 2 } }),
    )
    const reversed = applyBody(
      state({ report: mappingReport, mappings: { "resolver:aaaa": 2, "engine:bbbb": 4 } }),
    )

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })

  it("serializes byte-identically on repeated calls with the same inputs", () => {
    const current = state({
      report: mappingReport,
      mappings: { "engine:bbbb": 4 },
      excludedProfiles: ["p3"],
      profileMissing: { t3: { kind: "inline" } },
      engineOverrides: { t3: "inherit" },
    })

    expect(JSON.stringify(applyBody(current))).toBe(JSON.stringify(applyBody(current)))
  })

  it("returns null when the bundle or report is missing", () => {
    expect(applyBody(state({ bundle: null }))).toBeNull()
    expect(applyBody(state({ report: null }))).toBeNull()
  })
})

describe("unresolvedCount / canApply", () => {
  it("is zero for a clean report with nothing to resolve", () => {
    const current = state()

    expect(unresolvedCount(current)).toBe(0)
    expect(canApply(current)).toBe(true)
  })

  it("counts an unmapped plugin requirement until a mapping is chosen", () => {
    const mappingReport = validateReportSchema.parse({
      valid: false,
      profiles: [
        {
          name: "p",
          valid: false,
          issues: [{ problem: "not_installed", field: "engine", bundled: { name: "x", origin_hash: "h" } }],
        },
      ],
    })
    const unresolved = state({ report: mappingReport })
    expect(unresolvedCount(unresolved)).toBe(1)
    expect(canApply(unresolved)).toBe(false)

    const resolved = state({ report: mappingReport, mappings: { "engine:h": 4 } })
    expect(unresolvedCount(resolved)).toBe(0)
    expect(canApply(resolved)).toBe(true)
  })

  it("counts an unbound profile_missing requirement until a resolution is chosen", () => {
    const missingReport = validateReportSchema.parse({
      valid: false,
      autoruns: [
        { name: "t2", valid: false, issues: [{ problem: "profile_missing", profile_name: "p-gone" }] },
      ],
    })
    expect(unresolvedCount(state({ report: missingReport }))).toBe(1)
    expect(
      unresolvedCount(
        state({ report: missingReport, profileMissing: { t2: { kind: "bind", profileName: "p9" } } }),
      ),
    ).toBe(0)
  })

  it("cannot apply outside the resolve step", () => {
    expect(canApply(state({ step: "review" }))).toBe(false)
    expect(canApply(state({ status: "applying" }))).toBe(false)
  })
})
