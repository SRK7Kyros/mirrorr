import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { apiFetch, resetSession, setForcedLogoutHandler } from "@/lib/api"
import {
  PASSWORD_CHANGED_MESSAGE,
  changePasswordAndSignOut,
  clearSession,
  getAuthState,
  installAuthSession,
  setAuthSession,
  signOut,
} from "@/lib/auth-store"
import { queryKeys } from "@/lib/query-keys"
import { clearToasts, getToasts } from "@/lib/toast"
import { queryClient } from "@/query-client"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const navigateToLogin = vi.fn()

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  queryClient.clear()
  clearToasts()
  resetSession()
  setForcedLogoutHandler(null)
  navigateToLogin.mockReset()
  installAuthSession({ navigateToLogin, getCurrentHref: () => "/sessions" })
})

afterEach(() => {
  setForcedLogoutHandler(null)
  resetSession()
  clearToasts()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("forced logout (spec L150-L156)", () => {
  it("wipes the cache, marks the session expired and routes to /login", async () => {
    setAuthSession(AUTH_BODY)
    queryClient.setQueryData(queryKeys.sessions(), { pages: [] })
    installFetch(async (url) =>
      url.endsWith("/auth/refresh")
        ? jsonResponse(401, { detail: "refresh revoked" })
        : jsonResponse(401, { detail: "expired" }),
    )

    await expect(apiFetch("/sessions/", {})).rejects.toThrow()

    expect(queryClient.getQueryData(queryKeys.sessions())).toBeUndefined()
    expect(getAuthState().sessionExpired).toBe(true)
    expect(getAuthState().user).toBeNull()
    expect(navigateToLogin).toHaveBeenCalledWith("/sessions")
  })

  it("does not claim an expired session when there never was a session", async () => {
    installFetch(async () => jsonResponse(401, { detail: "no session" }))

    await expect(apiFetch("/sessions/", {})).rejects.toThrow()

    expect(getAuthState().sessionExpired).toBe(false)
    expect(getAuthState().user).toBeNull()
    expect(navigateToLogin).toHaveBeenCalledWith("/sessions")
  })
})

describe("logout flows (spec L53, L371)", () => {
  it("clearSession drops the user and routes to /login", () => {
    setAuthSession(AUTH_BODY)
    clearSession()

    expect(getAuthState().user).toBeNull()
    expect(navigateToLogin).toHaveBeenCalledWith("/sessions")
  })

  it("signOut revokes through the API and then clears locally", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, {}))
    setAuthSession(AUTH_BODY)

    await signOut()

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/auth/logout")
    expect(getAuthState().user).toBeNull()
    expect(navigateToLogin).toHaveBeenCalledWith("/sessions")
  })

  it("change password forces the logout flow with the spec toast", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, {}))
    setAuthSession(AUTH_BODY)

    await changePasswordAndSignOut("admin123", "next-password")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/auth/change-password")
    expect(getToasts().map((toast) => toast.message)).toContain(PASSWORD_CHANGED_MESSAGE)
    expect(getAuthState().user).toBeNull()
    expect(navigateToLogin).toHaveBeenCalledWith("/sessions")
  })

  it("does not clear the session when the password change is rejected", async () => {
    installFetch(async () => jsonResponse(400, { detail: "Old password is incorrect" }))
    setAuthSession(AUTH_BODY)

    await expect(changePasswordAndSignOut("wrong", "next-password")).rejects.toThrow(
      "Old password is incorrect",
    )

    expect(getAuthState().user).not.toBeNull()
    expect(navigateToLogin).not.toHaveBeenCalled()
  })
})
