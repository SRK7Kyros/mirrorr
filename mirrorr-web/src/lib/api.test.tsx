import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { API_URL_ENV_VAR } from "@/config/env"
import { apiFetch, resetSession, setAuthTransport, setForcedLogoutHandler } from "@/lib/api"
import { ApiError } from "@/lib/errors"
import { cursorPageSchema } from "@/lib/schemas/pagination"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const sessionsPageSchema = cursorPageSchema(z.object({ id: z.number() }))

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetSession()
  setForcedLogoutHandler(null)
  setAuthTransport({ kind: "cookie" })
})

describe("apiFetch transport", () => {
  it("appends the path verbatim and sends cookie credentials", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { ok: true }))
    const schema = z.object({ ok: z.boolean() })

    await apiFetch("/sessions/", { schema })
    await apiFetch("/sessions", { schema })

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/sessions/",
      "/api/sessions",
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe("include")
    }
  })

  it("sets the JSON content type only when a body is present", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { ok: true }))
    const schema = z.object({ ok: z.boolean() })

    await apiFetch("/auth/logout", { method: "POST", body: {}, schema })
    await apiFetch("/sessions/1", { schema })

    const postCall = fetchMock.mock.calls[0]
    const getCall = fetchMock.mock.calls[1]
    expect(new Headers(postCall?.[1]?.headers).get("Content-Type")).toBe("application/json")
    expect(new Headers(getCall?.[1]?.headers).get("Content-Type")).toBeNull()
  })

  it("exposes the bearer transport seam for the wrapper build", async () => {
    setAuthTransport({ kind: "bearer", getAccessToken: () => "wrapper-jwt" })
    const fetchMock = installFetch(async () => jsonResponse(200, { ok: true }))

    await apiFetch("/auth/me", { schema: z.object({ ok: z.boolean() }) })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer wrapper-jwt")
    expect(init?.credentials).toBe("omit")
  })
})

describe("apiFetch responses", () => {
  it("maps a 422 detail array onto field errors", async () => {
    installFetch(async () =>
      jsonResponse(422, {
        detail: [
          { type: "missing", loc: ["body", "engine_id"], msg: "Field required" },
          {
            type: "string_type",
            loc: ["body", "capture", "output_dir"],
            msg: "Input should be a valid string",
          },
        ],
      }),
    )

    const error = await apiFetch("/sessions/", {
      method: "POST",
      body: {},
      schema: z.object({}),
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw new Error("expected ApiError")
    expect(error.status).toBe(422)
    expect(error.detail).toBe("Validation failed")
    expect(error.fieldErrors).toEqual({
      engine_id: "Field required",
      "capture.output_dir": "Input should be a valid string",
    })
  })

  it("surfaces a 500 with a non-JSON body as a typed error", async () => {
    installFetch(async () => new Response("<html>boom</html>", { status: 500 }))

    const error = await apiFetch("/sessions/", { schema: z.object({}) }).catch(
      (cause: unknown) => cause,
    )

    expect(error).toBeInstanceOf(ApiError)
    if (!(error instanceof ApiError)) throw new Error("expected ApiError")
    expect(error.status).toBe(500)
    expect(error.detail).toBe("HTTP 500")
  })

  it("returns undefined for a 204 without parsing the body", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const fetchMock = installFetch(async () => new Response(null, { status: 204 }))

    const result = await apiFetch("/sessions/1", {
      method: "DELETE",
      schema: z.object({ never: z.string() }),
    })

    expect(result).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe("apiFetch 401 flow", () => {
  it("refreshes exactly once across two concurrent 401s and retries both", async () => {
    let sessionCalls = 0
    let refreshCalls = 0
    installFetch(async (url) => {
      if (url === "/api/auth/refresh") {
        refreshCalls += 1
        return jsonResponse(200, AUTH_BODY)
      }
      sessionCalls += 1
      return sessionCalls <= 2
        ? jsonResponse(401, { detail: "Not authenticated" })
        : jsonResponse(200, { items: [], next_cursor: null, has_more: false })
    })

    const [first, second] = await Promise.all([
      apiFetch("/sessions/", { schema: sessionsPageSchema }),
      apiFetch("/sessions/", { schema: sessionsPageSchema }),
    ])

    expect(refreshCalls).toBe(1)
    expect(sessionCalls).toBe(4)
    expect(first).toEqual({ items: [], next_cursor: null, has_more: false })
    expect(second).toEqual({ items: [], next_cursor: null, has_more: false })
  })

  it("forces logout when the retried request is rejected again", async () => {
    const logout = vi.fn()
    setForcedLogoutHandler(logout)

    let sessionCalls = 0
    installFetch(async (url) => {
      if (url === "/api/auth/refresh") return jsonResponse(200, AUTH_BODY)
      sessionCalls += 1
      return sessionCalls === 1
        ? jsonResponse(401, { detail: "Not authenticated" })
        : jsonResponse(401, { detail: "Still not authenticated" })
    })

    const error = await apiFetch("/sessions/", { schema: sessionsPageSchema }).catch(
      (cause: unknown) => cause,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(logout).toHaveBeenCalledTimes(1)
    expect(logout).toHaveBeenCalledWith("retry-unauthorized")
  })

  it("never retries a failed refresh and never loops", async () => {
    const logout = vi.fn()
    setForcedLogoutHandler(logout)

    let refreshCalls = 0
    installFetch(async (url) => {
      if (url === "/api/auth/refresh") {
        refreshCalls += 1
        return jsonResponse(401, { detail: "Refresh token revoked" })
      }
      return jsonResponse(401, { detail: "Not authenticated" })
    })

    const first = await apiFetch("/sessions/", { schema: sessionsPageSchema }).catch(
      (cause: unknown) => cause,
    )
    const second = await apiFetch("/sessions/", { schema: sessionsPageSchema }).catch(
      (cause: unknown) => cause,
    )

    expect(first).toBeInstanceOf(ApiError)
    expect(second).toBeInstanceOf(ApiError)
    expect(refreshCalls).toBe(1)
    expect(logout).toHaveBeenCalledTimes(1)
    expect(logout).toHaveBeenCalledWith("refresh-failed")
  })
})
