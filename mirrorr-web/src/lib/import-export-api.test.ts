/**
 * Import/export endpoint wrappers — client contract §9/§13.5.
 *
 * `validate` takes the RAW bundle object as its body (never wrapped);
 * `apply` takes `{bundle, plugin_map, removed_profiles?, removed_autoruns?}`.
 * Paths are exact (no trailing slash beyond the contract's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { applyBundle, validateBundle } from "@/lib/import-export-api"
import { ApiError } from "@/lib/errors"
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

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
