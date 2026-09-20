import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsAccountView } from "@/components/settings/SettingsAccountView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { getAuthState, installAuthSession, setAuthSession } from "@/lib/auth-store"
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_FRAME_EVENT,
  NOTIFICATION_PREFS_STORAGE_KEY,
  installNotificationFrameBridge,
} from "@/lib/notification-policy"
import { queryClient } from "@/query-client"
import { installFetch, jsonResponse } from "@/test/api-helpers"
import { clearToasts, getToasts } from "@/lib/toast"

const ADMIN_ME = {
  user: { id: 1, username: "admin", role: "admin", display_name: "Admin" },
  client: null,
}

function renderAccount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsAccountView />
      <ToastViewport />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  vi.restoreAllMocks()
  window.localStorage.clear()
  clearToasts()
  setAuthSession(ADMIN_ME)
})

describe("V11 user card", () => {
  it("renders the username, display name and role badge from the auth store", () => {
    renderAccount()

    const card = screen.getByTestId("settings-user-card")
    expect(card.textContent).toContain("admin")
    expect(card.textContent).toContain("Admin")
    expect(screen.getByTestId("user-card-username").textContent).toContain("admin")
    expect(screen.getByTestId("user-card-display-name").textContent).toContain("Admin")
    expect(within(card).getByTestId("role-badge").textContent).toContain("Administrator")
  })
})

describe("V11 change password", () => {
  it("shows the server 400 on the old-password field and does not log out", async () => {
    installFetch(async () => jsonResponse(400, { detail: "Invalid current password" }))
    const navigateToLogin = vi.fn()
    installAuthSession({ navigateToLogin, getCurrentHref: () => "/settings" })
      renderAccount()

    fireEvent.change(screen.getByLabelText("Old password"), { target: { value: "wrong-password" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    expect(await screen.findByText("Invalid current password")).toBeTruthy()
    expect(navigateToLogin).not.toHaveBeenCalled()
    expect(getAuthState().user).not.toBeNull()
    expect(screen.queryByText("Password changed — sign in again")).toBeNull()
  })

  it("posts the form, clears the session and shows the forced-logout toast on success", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    installFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) })
      return jsonResponse(200, { status: "password_changed" })
    })
    const navigateToLogin = vi.fn()
    installAuthSession({ navigateToLogin, getCurrentHref: () => "/settings" })
    renderAccount()

    fireEvent.change(screen.getByLabelText("Old password"), { target: { value: "admin123" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    await waitFor(() => expect(navigateToLogin).toHaveBeenCalledWith("/settings"))
    expect(calls[0]?.url).toBe("/api/auth/change-password")
    expect(calls[0]?.body).toEqual({ old_password: "admin123", new_password: "new-password-1" })
    expect(await screen.findByText("Password changed — sign in again")).toBeTruthy()
    expect(getAuthState().user).toBeNull()
  })

  it("keeps a mismatched confirmation local (no request)", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { status: "password_changed" }))
    renderAccount()

    fireEvent.change(screen.getByLabelText("Old password"), { target: { value: "admin123" } })
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } })
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } })
    fireEvent.click(screen.getByRole("button", { name: "Change password" }))

    expect(await screen.findByText("Passwords do not match")).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("V11 notification preferences", () => {
  it("persists a toggle to localStorage", async () => {
    renderAccount()

    expect(screen.getByRole("switch", { name: "Crashes" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("switch", { name: "Crashes" }))

    expect(screen.getByRole("switch", { name: "Crashes" }).getAttribute("aria-checked")).toBe("false")
    expect(JSON.parse(window.localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY) ?? "{}")).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      crashes: false,
    })
  })

  it("restores stored preferences on mount", () => {
    window.localStorage.setItem(
      NOTIFICATION_PREFS_STORAGE_KEY,
      JSON.stringify({ crashes: false, completions: true, recordings: false }),
    )

    renderAccount()

    expect(screen.getByRole("switch", { name: "Crashes" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByRole("switch", { name: "Completions" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("switch", { name: "Recordings" }).getAttribute("aria-checked")).toBe("false")
  })

  it("gates the session.crashed toast on the crashes preference", async () => {
    installNotificationFrameBridge(window)
    renderAccount()

    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_FRAME_EVENT, {
        detail: { event_type: "session.crashed", title: "Session 7 crashed" },
      }),
    )
    expect(await screen.findByText("Session 7 crashed")).toBeTruthy()

    fireEvent.click(screen.getByRole("switch", { name: "Crashes" }))
    clearToasts()
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_FRAME_EVENT, {
        detail: { event_type: "session.crashed", title: "Session 8 crashed" },
      }),
    )
    expect(getToasts()).toHaveLength(0)
    expect(screen.queryByText("Session 8 crashed")).toBeNull()
  })
})
