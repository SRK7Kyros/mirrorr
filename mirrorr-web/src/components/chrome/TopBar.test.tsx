/**
 * Spec L17-L23 (top bar: title + right cluster), L49 (user menu logout →
 * `POST /auth/logout` + cache wipe), L399 (health banner), L187 (badge) and
 * the a11y floor (connection dot `role="status"` + text label; no bell for an
 * API-client principal).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "@/components/chrome/AppShell"
import { ConnectionDot, RealtimeIndicator } from "@/components/chrome/ConnectionDot"
import { UserMenu } from "@/components/chrome/UserMenu"
import { API_URL_ENV_VAR } from "@/config/env"
import {
  clearAuthSession,
  getAuthState,
  isApiClientPrincipal,
  setApiClientSession,
  setAuthSession,
} from "@/lib/auth-store"
import { addSyntheticNotification, resetSyntheticNotifications } from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { resetRealtimeStatus, setRealtimeStatus } from "@/lib/realtime-status"
import { queryClient } from "@/query-client"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"
import { renderInRouter } from "@/test/router-harness"

const API_CLIENT_PRINCIPAL = {
  user: null,
  client: { id: 7, name: "ops-key" },
  sessionExpired: false,
} as const

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  queryClient.clear()
  resetSyntheticNotifications()
  resetRealtimeStatus()
})

afterEach(() => {
  clearAuthSession()
  resetSyntheticNotifications()
  resetRealtimeStatus()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("view title", () => {
  it("derives the top-bar title from the current route", async () => {
    await renderInRouter(<AppShell />, "/autoruns/5")

    expect(screen.getByTestId("view-title").textContent).toBe("Autoruns")
  })

  it("labels the settings sub-routes and Import/Export", async () => {
    await renderInRouter(<AppShell />, "/settings/users")
    expect(screen.getByTestId("view-title").textContent).toBe("Settings")

    await renderInRouter(<AppShell />, "/import-export")
    expect(screen.getAllByTestId("view-title").at(-1)?.textContent).toBe("Import/Export")
  })
})

describe("connection dot", () => {
  it("always pairs role=status with a text label", async () => {
    render(<ConnectionDot status="live" />)
    const live = screen.getByRole("status")
    expect(live.getAttribute("data-status")).toBe("live")
    expect(live.textContent).toContain("Live")

    render(<ConnectionDot status="reconnecting" />)
    expect(screen.getAllByRole("status").at(-1)?.textContent).toContain("Reconnecting")

    render(<ConnectionDot status="offline" />)
    expect(screen.getAllByRole("status").at(-1)?.textContent).toContain("Polling")
  })

  it("renders the label for the store-driven state", async () => {
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("offline")

    render(<RealtimeIndicator />)

    const status = screen.getByRole("status")
    expect(status.getAttribute("data-status")).toBe("offline")
    expect(status.textContent).toContain("Polling")
  })

  it("replaces the dot with the static polling label for an API-client principal", async () => {
    setApiClientSession({ id: 7, name: "ops-key" })
    render(<RealtimeIndicator />)

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByTestId("api-client-polling-label").textContent).toBe(
      "API client — polling every 10s",
    )
  })
})

describe("principal predicates", () => {
  it("suppresses user-only surfaces for an API-client principal", async () => {
    expect(isApiClientPrincipal(API_CLIENT_PRINCIPAL)).toBe(true)
    expect(isApiClientPrincipal({ user: AUTH_BODY.user, client: null, sessionExpired: false })).toBe(false)
    expect(isApiClientPrincipal({ user: null, client: null, sessionExpired: false })).toBe(false)
  })
})

describe("user menu", () => {
  it("shows the display name and logs out through POST /auth/logout with a cache wipe", async () => {
    setAuthSession(AUTH_BODY)
    queryClient.setQueryData(queryKeys.sessions(), { pages: [] })
    const fetchMock = installFetch(async (url) =>
      url.endsWith("/auth/logout") ? jsonResponse(200, { status: "ok" }) : jsonResponse(200, []),
    )
    const { router } = await renderInRouter(<UserMenu />, "/sessions")

    fireEvent.click(screen.getByTestId("user-menu-button"))
    expect(screen.getByRole("menuitem", { name: "Change password" })).toBeTruthy()
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/auth/logout"))).toBe(true)
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login")
    })
    expect(getAuthState().user).toBeNull()
    expect(queryClient.getQueryData(queryKeys.sessions())).toBeUndefined()
  })

  it("routes Change password to /settings", async () => {
    setAuthSession(AUTH_BODY)
    const { router } = await renderInRouter(<UserMenu />, "/sessions")

    fireEvent.click(screen.getByTestId("user-menu-button"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Change password" }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings")
    })
  })

  it("closes on Escape", async () => {
    setAuthSession(AUTH_BODY)
    await renderInRouter(<UserMenu />, "/sessions")

    fireEvent.click(screen.getByTestId("user-menu-button"))
    expect(screen.getByTestId("user-menu")).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId("user-menu"), { key: "Escape" })
    expect(screen.queryByTestId("user-menu")).toBeNull()
  })
})

describe("health banner", () => {
  it("renders 'API unreachable — retrying' when GET /health fails", async () => {
    setAuthSession(AUTH_BODY)
    installFetch(async (url) =>
      url.endsWith("/health") ? jsonResponse(503, { detail: "down" }) : jsonResponse(200, []),
    )

    await renderInRouter(<AppShell />, "/sessions")

    const banner = await screen.findByText("API unreachable — retrying")
    expect(banner.closest('[role="status"]')).toBeTruthy()
  })
})

describe("shell", () => {
  it("renders sidebar, top bar, main region and the compact primary-action slot", async () => {
    setAuthSession(AUTH_BODY)
    installFetch(async (url) =>
      url.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(200, []),
    )

    await renderInRouter(<AppShell />, "/sessions")

    expect(screen.getByTestId("sidebar")).toBeTruthy()
    expect(screen.getByTestId("top-bar")).toBeTruthy()
    expect(screen.getByTestId("shell-main")).toBeTruthy()
    expect(screen.queryByText("API unreachable — retrying")).toBeNull()
  })

  it("shows the notification bell for a user principal", async () => {
    setAuthSession(AUTH_BODY)
    addSyntheticNotification({
      resource_type: "session",
      resource_id: 5,
      event_type: "session.crashed",
      title: "session 5 crashed",
    })
    installFetch(async (url) =>
      url.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(200, []),
    )

    await renderInRouter(<AppShell />, "/sessions")

    const bell = await screen.findByTestId("notification-bell")
    expect(bell.getAttribute("aria-label")).toBe("1 unread notifications")
    expect(within(bell).getByTestId("notification-badge").textContent).toBe("1")
  })
})
