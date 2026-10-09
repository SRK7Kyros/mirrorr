import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiFetch, resetAuthExhausted, setAuthExhaustedHandler } from "./client"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const AUTH_OK = {
  user: { id: 1, username: "admin", role: "admin", display_name: "Admin" },
}

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>

describe("apiFetch", () => {
  beforeEach(() => {
    resetAuthExhausted()
    setAuthExhaustedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setAuthExhaustedHandler(null)
  })

  it("single-flights concurrent 401s into exactly one POST /auth/refresh", async () => {
    const attempts = new Map<string, number>()
    let refreshCount = 0
    const fetchMock: FetchMock = vi.fn(async (input: string) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) {
        refreshCount += 1
        await Promise.resolve()
        return jsonResponse(200, AUTH_OK)
      }
      const seen = (attempts.get(url) ?? 0) + 1
      attempts.set(url, seen)
      if (seen === 1) return jsonResponse(401, { detail: "Not authenticated" })
      return jsonResponse(200, { ok: true, url })
    })
    vi.stubGlobal("fetch", fetchMock)

    const results = await Promise.all([
      apiFetch<{ ok: boolean }>("/sessions/"),
      apiFetch<{ ok: boolean }>("/sessions/?limit=50"),
      apiFetch<{ ok: boolean }>("/autoruns/"),
    ])

    expect(refreshCount).toBe(1)
    expect(results.map((result) => result.ok)).toEqual([true, true, true])
    // 3 first attempts + 1 refresh + 3 retries — never more.
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it("rejects every waiter and fires the exhaustion seam once when refresh 401s", async () => {
    const handler = vi.fn()
    setAuthExhaustedHandler(handler)
    const fetchMock: FetchMock = vi.fn(async (input: string) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) {
        return jsonResponse(401, { detail: "Invalid or expired refresh token" })
      }
      return jsonResponse(401, { detail: "Not authenticated" })
    })
    vi.stubGlobal("fetch", fetchMock)

    const results = await Promise.allSettled([
      apiFetch("/sessions/"),
      apiFetch("/autoruns/"),
      apiFetch("/profiles/"),
    ])

    expect(results.every((result) => result.status === "rejected")).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("parses FastAPI 422 detail arrays into fieldErrors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          detail: [
            { loc: ["body", "username"], msg: "Field required", type: "missing" },
            { loc: ["body", "password"], msg: "At least 8 characters", type: "string_too_short" },
          ],
        }),
      ),
    )

    const error = await apiFetch("/auth/register", {
      method: "POST",
      body: {},
      skipAuthRefresh: true,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(422)
    expect(apiError.fieldErrors).toEqual({
      username: "Field required",
      password: "At least 8 characters",
    })
    expect(apiError.message).toBe("username: Field required; password: At least 8 characters")
  })

  it("parses the custom {detail, errors} shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, {
          detail: "Profile name already exists",
          errors: { name: "already exists", tags: ["a", "b"] },
        }),
      ),
    )

    const error = await apiFetch("/profiles/", {
      method: "POST",
      body: { name: "x" },
      skipAuthRefresh: true,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.message).toBe("Profile name already exists")
    expect(apiError.fieldErrors).toEqual({ name: "already exists", tags: "a; b" })
  })

  it("returns undefined for 204 without parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))

    const result = await apiFetch("/sessions/1", { method: "DELETE" })
    expect(result).toBeUndefined()
  })

  it("sends credentials include and never reads document.cookie", async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse(200, { ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    await apiFetch("/auth/me")

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.credentials).toBe("include")
  })
})
