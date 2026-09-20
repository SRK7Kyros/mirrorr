/**
 * V8's delete pre-scan (spec L331, client contract §13.6): count the cached
 * autoruns/sessions that reference a profile before offering the delete
 * confirmation, fetching the lists when the cache is cold.
 */
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { queryKeys } from "@/lib/query-keys"
import { cachedProfileRefs, collectProfileRefs } from "@/lib/profile-refs"
import { installFetch, jsonResponse } from "@/test/api-helpers"

function seed(client: QueryClient, key: readonly unknown[], items: readonly unknown[]): void {
  client.setQueryData(key, {
    pages: [{ items, next_cursor: null, has_more: false }],
    pageParams: [null],
  })
}

const AUTORUNS = [
  {
    id: 11,
    user_friendly_name: "Nightly",
    snake_case_name: "nightly",
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    start_time: "23:00",
    end_time: "23:10",
    profile_id: 9,
  },
  {
    id: 12,
    user_friendly_name: "Other",
    snake_case_name: "other",
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    start_time: "23:00",
    end_time: "23:10",
    profile_id: 4,
  },
]

const SESSIONS = [
  { id: 21, engine_id: 1, resolver_id: 1, status: "completed", profile_id: 9 },
  { id: 22, engine_id: 1, resolver_id: 1, status: "failed", profile_id: null },
  { id: 23, engine_id: 1, resolver_id: 1, status: "completed", profile_id: 9 },
]

function emptyPage() {
  return jsonResponse(200, { items: [], next_cursor: null, has_more: false })
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("cachedProfileRefs", () => {
  it("counts only the cached rows referencing the profile", () => {
    const client = new QueryClient()
    seed(client, queryKeys.autoruns(), AUTORUNS)
    seed(client, queryKeys.sessions(), SESSIONS)

    expect(cachedProfileRefs(client, 9)).toEqual({
      autoruns: [{ id: 11, name: "Nightly" }],
      sessions: [
        { id: 21, name: "#21" },
        { id: 23, name: "#23" },
      ],
    })
  })

  it("returns empty lists when nothing is cached", () => {
    expect(cachedProfileRefs(new QueryClient(), 9)).toEqual({ autoruns: [], sessions: [] })
  })
})

describe("collectProfileRefs", () => {
  it("uses the cache without a request when both lists are loaded", async () => {
    const client = new QueryClient()
    seed(client, queryKeys.autoruns(), AUTORUNS)
    seed(client, queryKeys.sessions(), SESSIONS)
    const fetchMock = installFetch(async () => emptyPage())

    const refs = await collectProfileRefs(client, 9)
    expect(refs.autoruns).toHaveLength(1)
    expect(refs.sessions).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches the lists when cold and scans every item", async () => {
    const client = new QueryClient()
    const fetchMock = installFetch(async (url) => {
      const path = new URL(url, "http://localhost").pathname
      if (path.endsWith("/autoruns/")) {
        return jsonResponse(200, { items: AUTORUNS, next_cursor: null, has_more: false })
      }
      if (path.endsWith("/sessions/")) {
        return jsonResponse(200, { items: SESSIONS, next_cursor: null, has_more: false })
      }
      return emptyPage()
    })

    const refs = await collectProfileRefs(client, 9)
    expect(refs).toEqual({
      autoruns: [{ id: 11, name: "Nightly" }],
      sessions: [
        { id: 21, name: "#21" },
        { id: 23, name: "#23" },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
