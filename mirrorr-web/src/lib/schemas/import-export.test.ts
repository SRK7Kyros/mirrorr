/**
 * Import/export wire contracts — client contract §9 and §13.5 (bundle shape,
 * validate report, apply response). The live core (verified
 * `mirrorr-core/src/mirrorr/api/routers/import_export.py`) adds `created` and
 * `renamed` to the apply response, so the response schema must passthrough.
 */
import { describe, expect, it } from "vitest"
import {
  applyResponseSchema,
  bundleSchema,
  validateReportSchema,
} from "@/lib/schemas/import-export"

const PROFILE_ENTRY = {
  name: "p2",
  default_engine: { name: "yt_dlp_piped", origin_hash: "6e57" },
  resolver: { name: "static", origin_hash: "f1c2" },
  resolver_config: { url: "https://example.com/live.m3u8" },
  retry_mode: "none",
  retry_config: {},
  content_hash: "4494",
}

const AUTORUN_ENTRY = {
  user_friendly_name: "t2",
  profile_name: "p2",
  profile: PROFILE_ENTRY,
  start_time: "2050-07-15T15:12:00",
  end_time: "2050-07-15T16:12:00",
  recording: true,
  engine_override: { name: "yt_dlp_piped", origin_hash: "override" },
  content_hash: "aa11",
}

describe("bundleSchema", () => {
  it("parses a full export bundle and defaults absent collections", () => {
    const parsed = bundleSchema.parse({ version: 1, exported_at: "2050-01-01T00:00:00" })

    expect(parsed.profiles).toEqual([])
    expect(parsed.autoruns).toEqual([])
  })

  it("parses profile and autorun entries with their contract fields", () => {
    const parsed = bundleSchema.parse({ version: 1, profiles: [PROFILE_ENTRY], autoruns: [AUTORUN_ENTRY] })

    expect(parsed.profiles[0]?.name).toBe("p2")
    expect(parsed.profiles[0]?.default_engine?.origin_hash).toBe("6e57")
    expect(parsed.autoruns[0]?.profile?.name).toBe("p2")
    expect(parsed.autoruns[0]?.engine_override?.origin_hash).toBe("override")
  })

  it("keeps unknown bundle and entry keys so the edited bundle round-trips", () => {
    const parsed = bundleSchema.parse({
      version: 1,
      future_top_level: { a: 1 },
      profiles: [{ ...PROFILE_ENTRY, future_entry_key: "keep" }],
    }) as Record<string, unknown>

    expect(parsed.future_top_level).toEqual({ a: 1 })
    const entry = (parsed.profiles as Record<string, unknown>[])[0]
    expect(entry?.future_entry_key).toBe("keep")
  })

  it("rejects a bundle without a numeric version", () => {
    expect(bundleSchema.safeParse({ profiles: [] }).success).toBe(false)
  })
})

describe("validateReportSchema", () => {
  it("parses the contract example with every issue variant", () => {
    const parsed = validateReportSchema.parse({
      valid: false,
      profiles: [
        { name: "p2", content_hash: "4494", valid: true, issues: [{ problem: "already_exists", existing_id: 1 }] },
        {
          name: "p-missing-eng",
          content_hash: "abc",
          valid: false,
          issues: [
            {
              problem: "not_installed",
              field: "engine",
              bundled: { name: "engine_x", origin_hash: "dead" },
              alternatives: [{ id: 1, name: "yt_dlp_piped", origin_hash: "6e57" }],
            },
            { problem: "name_conflict", existing_id: 2, new_name: "p-missing-eng_2" },
          ],
        },
      ],
      autoruns: [
        {
          name: "t2",
          valid: false,
          issues: [
            { problem: "profile_missing", profile_name: "p-gone" },
            { problem: "engine_override" },
          ],
        },
      ],
    })

    expect(parsed.profiles[0]?.issues[0]?.problem).toBe("already_exists")
    expect(parsed.profiles[1]?.issues[0]?.bundled?.origin_hash).toBe("dead")
    expect(parsed.profiles[1]?.issues[1]?.new_name).toBe("p-missing-eng_2")
    expect(parsed.autoruns[0]?.issues[0]?.profile_name).toBe("p-gone")
  })

  it("defaults absent issue arrays to empty", () => {
    const parsed = validateReportSchema.parse({ valid: true, profiles: [{ name: "p", valid: true }] })

    expect(parsed.profiles[0]?.issues).toEqual([])
    expect(parsed.autoruns).toEqual([])
  })
})

describe("applyResponseSchema", () => {
  it("parses the three contract counts", () => {
    const parsed = applyResponseSchema.parse({
      profiles_created: 2,
      profiles_skipped: 1,
      autoruns_created: 3,
    })

    expect(parsed).toMatchObject({ profiles_created: 2, profiles_skipped: 1, autoruns_created: 3 })
  })

  it("tolerates the live core's created/renamed enrichment", () => {
    const parsed = applyResponseSchema.parse({
      profiles_created: 1,
      profiles_skipped: 0,
      autoruns_created: 0,
      created: { profiles: [{ id: 7, name: "p_2" }], autoruns: [] },
      renamed: { p: "p_2" },
    })

    expect(parsed.profiles_created).toBe(1)
  })
})
