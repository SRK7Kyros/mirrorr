/**
 * V7 recording endpoints (spec L315-L316, client contract §6): paginated list
 * and the file-deleting DELETE. There is no POST/PUT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { deleteRecording, fetchRecordingsPage } from "@/lib/recordings-api"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const RECORDING = {
  id: 4,
  user_friendly_name: "Morning capture",
  snake_case_name: "morning_capture",
  disk_path: "/data/rec.mp4",
  content_url: "",
  engine_name: "yt_dlp_piped",
  resolver_name: "static",
  duration_seconds: 65,
  size_bytes: 1024,
  created_at: "2026-09-19T10:00:00",
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("fetchRecordingsPage", () => {
  it("GETs the paginated list with the exact path and limit", async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { items: [RECORDING], next_cursor: null, has_more: false }),
    )

    const page = await fetchRecordingsPage({ cursor: null, limit: 50, signal: new AbortController().signal })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.user_friendly_name).toBe("Morning capture")

    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toBe("/api/recordings/?limit=50")
  })

  it("passes the cursor once paging", async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { items: [], next_cursor: null, has_more: false }),
    )
    await fetchRecordingsPage({ cursor: 12, limit: 50, signal: new AbortController().signal })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/recordings/?limit=50&cursor=12")
  })
})

describe("deleteRecording", () => {
  it("DELETEs the exact resource path", async () => {
    const fetchMock = installFetch(async () => new Response(null, { status: 204 }))
    await deleteRecording(4)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/recordings/4")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" })
  })
})
