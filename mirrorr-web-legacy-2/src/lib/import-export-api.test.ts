/**
 * Import/export endpoint wrappers — client contract §9/§13.5.
 *
 * `validate` takes the RAW bundle object as its body (never wrapped);
 * `apply` takes `{bundle, plugin_map, removed_profiles?, removed_autoruns?}`.
 * Paths are exact (no trailing slash beyond the contract's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { applyBundle, exportAutorunBundle, exportProfileBundle, validateBundle } from "@/lib/import-export-api"
import { ApiError, ApiParseError } from "@/lib/errors"
import { bundleSchema, type ApplyBody } from "@/lib/schemas/import-export"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const BUNDLE = bundleSchema.parse({
  version: 1,
  profiles: [
    {
      name: "p2",
      default_engine: { name: "yt_dlp_piped", origin_hash: "6e57" },
      resolver: { name: "static", origin_hash: "f1c2" },
      resolver_config: { url: "https://example.com/a.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  ],
  autoruns: [],
})

const AUTORUN_BUNDLE = bundleSchema.parse({
  version: 1,
  exported_at: "2026-09-20T12:00:00",
  profiles: [],
  autoruns: [
    {
      user_friendly_name: "Morning run",
      profile_name: "p2",
      profile: { name: "p2" },
      start_time: "2030-07-15T15:12:00",
      end_time: "2030-07-15T16:12:00",
      recording: true,
    },
  ],
})

const REPORT = {
  valid: false,
  profiles: [
    {
      name: "p2",
      content_hash: "4494",
      valid: false,
      issues: [{ problem: "name_conflict", existing_id: 2, new_name: "p2_2" }],
    },
  ],
  autoruns: [],
}

describe("validateBundle", () => {
  it("POSTs the raw bundle object to /import-export/validate", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, REPORT))

    const report = await validateBundle(BUNDLE)

    expect(report.profiles[0]?.issues[0]?.problem).toBe("name_conflict")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/import-export/validate")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual(BUNDLE)
    expect((init?.headers as Headers).get("Content-Type")).toBe("application/json")
  })

  it("throws the server detail on a 400", async () => {
    installFetch(async () => jsonResponse(400, { detail: "Unsupported bundle version: 2" }))

    await expect(validateBundle(BUNDLE)).rejects.toMatchObject({
      status: 400,
      detail: "Unsupported bundle version: 2",
    })
    await expect(validateBundle(BUNDLE)).rejects.toBeInstanceOf(ApiError)
  })
})

describe("applyBundle", () => {
  it("POSTs the exact apply body to /import-export/apply", async () => {
    const body: ApplyBody = {
      bundle: BUNDLE,
      plugin_map: { "6e57": { type: "engine", id: 4 } },
      removed_profiles: ["p9"],
    }
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { profiles_created: 1, profiles_skipped: 0, autoruns_created: 0 }),
    )

    const summary = await applyBundle(body)

    expect(summary.profiles_created).toBe(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/import-export/apply")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual(body)
  })

  it("throws the server detail when apply revalidation rejects an edited entry", async () => {
    installFetch(async () => jsonResponse(400, { detail: "Cannot resolve engine for profile 'p2'" }))

    await expect(applyBundle({ bundle: BUNDLE, plugin_map: {} })).rejects.toMatchObject({
      detail: "Cannot resolve engine for profile 'p2'",
    })
  })
})

describe("exportProfileBundle", () => {
  it("GETs the profile export path with cookie credentials and without a token in the URL", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, BUNDLE))

    const text = await exportProfileBundle(9)

    expect(text).toBe(JSON.stringify(BUNDLE))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/import-export/profiles/9/export")
    expect(init?.method).toBe("GET")
    expect(init?.credentials).toBe("include")
    expect(new URL(String(url), "http://localhost").search).toBe("")
    expect(String(url)).not.toMatch(/token|api_key|authorization/i)
    expect((init?.headers as Headers).get("Authorization")).toBeNull()
  })

  it("surfaces the 403 detail when the profile is not the caller's", async () => {
    installFetch(async () => jsonResponse(403, { detail: "Not authorized to export this resource" }))

    await expect(exportProfileBundle(9)).rejects.toMatchObject({
      status: 403,
      detail: "Not authorized to export this resource",
    })
  })

  it("rejects a bundle that is not version 1 with a parse error", async () => {
    installFetch(async () => jsonResponse(200, { version: 2, profiles: [], autoruns: [] }))

    await expect(exportProfileBundle(9)).rejects.toBeInstanceOf(ApiParseError)
  })
})

describe("exportAutorunBundle", () => {
  it("GETs the autorun export path with cookie credentials and no token in the URL", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, AUTORUN_BUNDLE))

    const text = await exportAutorunBundle(7)

    expect(JSON.parse(text).autoruns[0].user_friendly_name).toBe("Morning run")
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe("/api/import-export/autoruns/7/export")
    expect(init?.method).toBe("GET")
    expect(init?.credentials).toBe("include")
    expect(new URL(String(url), "http://localhost").search).toBe("")
  })

  it("rejects a malformed body as a parse error", async () => {
    installFetch(async () => new Response("<html>gateway</html>", { status: 200 }))

    await expect(exportAutorunBundle(7)).rejects.toBeInstanceOf(ApiParseError)
  })
})

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
