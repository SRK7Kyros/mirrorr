import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildRunNowSessionBody,
  createAutorun,
  deleteAutorun,
  fetchAutorunsPage,
  fetchAutorun,
  saveAutorunAsProfile,
  updateAutorun,
} from "@/lib/autoruns-api"
import { API_URL_ENV_VAR } from "@/config/env"
import type { Autorun } from "@/lib/schemas/autoruns"
import { installFetch, jsonResponse } from "@/test/api-helpers"

/** Autorun endpoints (client spec §5) and the composed run-now body. */

const AUTHORUN: Autorun = {
  id: 7,
  user_friendly_name: "Morning show",
  snake_case_name: "morning_show",
  engine_id: 1,
  resolver_id: 2,
  resolver_config: { url: "https://example.com/a.m3u8" },
  retry_mode: "count",
  retry_config: { count: 3 },
  status: "scheduled",
  start_time: "2026-07-15T12:00:00",
  end_time: "2026-07-15T13:00:00",
  recording: true,
}

const PAGE = { items: [AUTHORUN], next_cursor: null, has_more: false }

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function signal(): AbortSignal {
  return new AbortController().signal
}

describe("autorun calls", () => {
  it("pages the list with cursor + limit", async () => {
    const fetchMock = installFetch(async (url) => {
      expect(url).toBe("/api/autoruns/?limit=50&cursor=12")
      return jsonResponse(200, PAGE)
    })

    const page = await fetchAutorunsPage({ cursor: 12, limit: 50, signal: signal() })
    expect(page.items[0]?.id).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("fetches one autorun by id", async () => {
    installFetch(async (url, init) => {
      expect(url).toBe("/api/autoruns/7")
      expect(init?.method ?? "GET").toBe("GET")
      return jsonResponse(200, AUTHORUN)
    })
    await expect(fetchAutorun(7)).resolves.toMatchObject({ id: 7, status: "scheduled" })
  })

  it("creates through POST /autoruns/", async () => {
    const body = {
      user_friendly_name: "Morning show",
      snake_case_name: "morning_show",
      profile_id: 9,
      start_time: "2026-07-15T12:00:00",
      end_time: "2026-07-15T13:00:00",
      recording: true,
    }
    installFetch(async (url, init) => {
      expect(url).toBe("/api/autoruns/")
      expect(init?.method).toBe("POST")
      expect(JSON.parse(String(init?.body))).toEqual(body)
      return jsonResponse(200, AUTHORUN)
    })
    await expect(createAutorun(body)).resolves.toMatchObject({ id: 7 })
  })

  it("updates through PUT /autoruns/{id} with only the sent fields", async () => {
    installFetch(async (url, init) => {
      expect(url).toBe("/api/autoruns/7")
      expect(init?.method).toBe("PUT")
      expect(JSON.parse(String(init?.body))).toEqual({ user_friendly_name: "Renamed" })
      return jsonResponse(200, { ...AUTHORUN, user_friendly_name: "Renamed" })
    })
    await expect(updateAutorun(7, { user_friendly_name: "Renamed" })).resolves.toMatchObject({
      user_friendly_name: "Renamed",
    })
  })

  it("deletes and saves-as-profile on the right paths", async () => {
    const fetchMock = installFetch(async (url, init) => {
      if (init?.method === "DELETE") {
        expect(url).toBe("/api/autoruns/7")
        return new Response(null, { status: 204 })
      }
      expect(url).toBe("/api/autoruns/7/save-as-profile")
      expect(JSON.parse(String(init?.body))).toEqual({ name: "From autorun" })
      return new Response(null, { status: 204 })
    })

    await expect(deleteAutorun(7)).resolves.toBeUndefined()
    await expect(saveAutorunAsProfile(7, "From autorun")).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("buildRunNowSessionBody", () => {
  it("composes POST /sessions/ from the autorun config (no run endpoint)", () => {
    expect(buildRunNowSessionBody(AUTHORUN)).toEqual({
      engine_id: 1,
      resolver_id: 2,
      resolver_config: { url: "https://example.com/a.m3u8" },
      retry_mode: "count",
      retry_config: { count: 3 },
      recording: true,
    })
  })

  it("defaults missing config/retry fields", () => {
    const bare: Autorun = { ...AUTHORUN, resolver_config: null, retry_mode: null, retry_config: null, recording: null }
    expect(buildRunNowSessionBody(bare)).toEqual({
      engine_id: 1,
      resolver_id: 2,
      resolver_config: {},
      retry_mode: "none",
      retry_config: {},
      recording: false,
    })
  })
})
