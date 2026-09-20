import { QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { resetSession, setForcedLogoutHandler } from "@/lib/api"
import { clearAuthSession, getAuthState, installAuthSession, setAuthSession } from "@/lib/auth-store"
import { queryKeys } from "@/lib/query-keys"
import { clearToasts, getToasts } from "@/lib/toast"
import { queryClient } from "@/query-client"
import { routeTree } from "@/router"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

/**
 * Route-level guard behaviour (docs/web-frontend-spec.md L29-L53):
 * - public branch: soft check of cached `["auth","me"]` and the `has_users` rule
 * - authenticated branch: 401 → one refresh → one retry, then forced logout
 * - admin gating: `user.role !== "admin"` never reaches `/settings/users`
 * - `?redirect` round-trip with the same-origin-only contract
 */

const NON_ADMIN_ME = {
  user: { id: 2, username: "viewer", role: "user", display_name: null },
}

function renderApp(initialPath: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  installAuthSession({
    navigateToLogin: (redirectPath) => {
      void router.navigate({ to: "/login", search: { redirect: redirectPath } })
    },
    getCurrentHref: () => router.state.location.href,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}

const EMPTY_PAGE = { items: [], next_cursor: null, has_more: false }
const LIST_PATHS = ["/sessions/", "/engines/", "/resolvers/", "/profiles/"]

function listFallback(url: string): Response {
  return LIST_PATHS.some((path) => url.includes(path)) ? jsonResponse(200, EMPTY_PAGE) : jsonResponse(200, {})
}

function stubAuthApi(overrides: Partial<Record<string, Response>> = {}) {
  return installFetch(async (url) => {
    if (url.endsWith("/auth/status")) {
      return jsonResponse(200, { has_users: true })
    }
    if (url.endsWith("/auth/me")) {
      return overrides.me ?? jsonResponse(200, AUTH_BODY)
    }
    if (url.endsWith("/auth/login")) {
      return overrides.login ?? jsonResponse(200, AUTH_BODY)
    }
    return listFallback(url)
  })
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  queryClient.clear()
  clearToasts()
  resetSession()
  setForcedLogoutHandler(null)
})

afterEach(() => {
  setForcedLogoutHandler(null)
  resetSession()
  clearToasts()
  clearAuthSession()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("public branch", () => {
  it("soft-redirects an authenticated user away from /login", async () => {
    queryClient.setQueryData(queryKeys.authMe(), AUTH_BODY)

    renderApp("/login")

    expect(await screen.findByTestId("sessions-view")).toBeTruthy()
  })

  it("bounces /register to /login when users already exist", async () => {
    stubAuthApi()

    const router = renderApp("/register")

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy()
    expect(router.state.location.pathname).toBe("/login")
    expect(screen.queryByTestId("register-form")).toBeNull()
  })

  it("renders the V2 bootstrap form when has_users is false", async () => {
    installFetch(async (url) =>
      url.endsWith("/auth/status")
        ? jsonResponse(200, { has_users: false })
        : jsonResponse(200, AUTH_BODY),
    )

    renderApp("/register")

    expect(
      await screen.findByRole("heading", { name: "Create the first admin account" }),
    ).toBeTruthy()
    expect(screen.getByText("This first account becomes the administrator")).toBeTruthy()
  })
})

describe("authenticated branch", () => {
  it("turns a 401 into exactly one refresh and one retry", async () => {
    const calls: string[] = []
    let meCalls = 0
    installFetch(async (url) => {
      calls.push(url)
      if (url.endsWith("/auth/me")) {
        meCalls += 1
        return meCalls === 1
          ? jsonResponse(401, { detail: "expired" })
          : jsonResponse(200, AUTH_BODY)
      }
      if (url.endsWith("/auth/refresh")) return jsonResponse(200, AUTH_BODY)
      return listFallback(url)
    })

    renderApp("/sessions")

    expect(await screen.findByTestId("sessions-view")).toBeTruthy()
    expect(calls.filter((url) => url.includes("/auth/"))).toEqual([
      "/api/auth/me",
      "/api/auth/refresh",
      "/api/auth/me",
    ])
    expect(meCalls).toBe(2)
  })

  it("wipes the cache and shows 'Session expired' on a second 401", async () => {
    setAuthSession(AUTH_BODY)
    queryClient.setQueryData(queryKeys.sessions(), { pages: [] })
    installFetch(async (url) => {
      if (url.endsWith("/auth/me")) return jsonResponse(401, { detail: "expired" })
      if (url.endsWith("/auth/refresh")) return jsonResponse(200, AUTH_BODY)
      if (url.endsWith("/auth/status")) return jsonResponse(200, { has_users: true })
      return listFallback(url)
    })

    const router = renderApp("/sessions")

    expect(await screen.findByText("Session expired")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/login")
    expect(queryClient.getQueryData(queryKeys.sessions())).toBeUndefined()
    expect(getAuthState().user).toBeNull()
    expect(getToasts().map((toast) => toast.message)).toContain("Session expired")
  })

  it("sends a non-admin from /settings/users back to /settings", async () => {
    installFetch(async (url) =>
      url.endsWith("/auth/me")
        ? jsonResponse(200, NON_ADMIN_ME)
        : jsonResponse(200, { has_users: true }),
    )

    const router = renderApp("/settings/users")

    expect(await screen.findByTestId("settings-placeholder")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/settings")
    expect(screen.queryByTestId("settings-users-placeholder")).toBeNull()
  })
})

describe("?redirect contract (spec L31, L53)", () => {
  it("round-trips a same-origin path through login", async () => {
    stubAuthApi()

    const router = renderApp("/login?redirect=%2Fautoruns")
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "admin" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "admin123" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByTestId("autoruns-view")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/autoruns")
  })

  it("rejects //evil and lands on /sessions", async () => {
    stubAuthApi()

    const router = renderApp("/login?redirect=%2F%2Fevil.example.com")
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "admin" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "admin123" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByTestId("sessions-view")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/sessions")
  })
})
