import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsUsersView } from "@/components/settings/SettingsUsersView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { queryClient } from "@/query-client"
import type { AuthUser } from "@/lib/schemas/auth"
import { installFetch, jsonResponse } from "@/test/api-helpers"
import { clearToasts } from "@/lib/toast"

const ADMIN: AuthUser = { id: 1, username: "admin", role: "admin", display_name: "Admin" }
const SECOND_ADMIN: AuthUser = { id: 2, username: "root", role: "admin", display_name: null }
const MEMBER: AuthUser = { id: 3, username: "bob", role: "user", display_name: "Bob" }

interface StubState {
  users: AuthUser[]
  calls: Array<{ url: string; method: string; body: unknown }>
}

function stubUsers(initial: AuthUser[]): StubState {
  const state: StubState = { users: [...initial], calls: [] }

  installFetch(async (url, init) => {
    const method = init?.method ?? "GET"
    state.calls.push({
      url,
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })

    if (url === "/api/auth/users" && method === "GET") return jsonResponse(200, state.users)
    if (url.startsWith("/api/auth/users/") && method === "DELETE") {
      const username = decodeURIComponent(url.slice("/api/auth/users/".length))
      state.users = state.users.filter((candidate) => candidate.username !== username)
      return jsonResponse(200, { status: "deleted", username })
    }
    if (url === "/api/auth/register" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { username: string; display_name?: string }
      const created: AuthUser = {
        id: state.users.length + 10,
        username: body.username,
        role: "user",
        display_name: body.display_name ?? null,
      }
      state.users = [...state.users, created]
      return jsonResponse(200, { user: created, client: null })
    }
    return jsonResponse(404, { detail: `unstubbed ${method} ${url}` })
  })

  return state
}

function renderUsers() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsUsersView />
      <ToastViewport />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  vi.restoreAllMocks()
  queryClient.clear()
  clearToasts()
})

describe("V12 users table", () => {
  it("renders username, display name and role badge per row", async () => {
    stubUsers([ADMIN, MEMBER])
    renderUsers()

    const rows = await screen.findAllByTestId("table-row")
    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).getByText("admin")).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText("Administrator")).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText("bob")).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText("User")).toBeTruthy()
  })

  it("disables delete and shows the last-admin tooltip when one admin remains", async () => {
    stubUsers([ADMIN, MEMBER])
    renderUsers()

    const rows = await screen.findAllByTestId("table-row")
    const adminDelete = within(rows[0] as HTMLElement).getByRole("button", { name: "Delete" })
    expect(adminDelete).toHaveProperty("disabled", true)
    expect(adminDelete.getAttribute("title")).toBe("Cannot delete the last admin")

    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Delete" })).toHaveProperty("disabled", false)
  })

  it("enables delete for admins when another admin remains", async () => {
    stubUsers([ADMIN, SECOND_ADMIN])
    renderUsers()

    const rows = await screen.findAllByTestId("table-row")
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Delete" })).toHaveProperty("disabled", false)
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "Delete" })).toHaveProperty("disabled", false)
  })

  it("requires the username to be typed before deleting and refreshes the list", async () => {
    const state = stubUsers([ADMIN, SECOND_ADMIN, MEMBER])
      renderUsers()

    const rows = await screen.findAllByTestId("table-row")
    fireEvent.click(within(rows[2] as HTMLElement).getByRole("button", { name: "Delete" }))

    const confirm = screen.getByRole("button", { name: "Delete user" })
    expect(confirm).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText("Type bob to confirm"), { target: { value: "bob" } })
    expect(confirm).toHaveProperty("disabled", false)
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.queryByText("bob")).toBeNull())
    expect(state.calls.some((call) => call.method === "DELETE" && call.url === "/api/auth/users/bob")).toBe(true)
  })

  it("toasts the server detail when the last admin delete is rejected", async () => {
    installFetch(async (_url, init) =>
      init?.method === "DELETE"
        ? jsonResponse(400, { detail: "Cannot delete the last admin user" })
        : jsonResponse(200, [ADMIN, SECOND_ADMIN]),
    )
    renderUsers()

    const rows = await screen.findAllByTestId("table-row")
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Delete" }))
    fireEvent.change(screen.getByLabelText("Type admin to confirm"), { target: { value: "admin" } })
    fireEvent.click(screen.getByRole("button", { name: "Delete user" }))

    expect(await screen.findByText("Cannot delete the last admin user")).toBeTruthy()
  })
})

describe("V12 create user", () => {
  it("creates through the admin-gated register endpoint and appends the row", async () => {
    const state = stubUsers([ADMIN])
    renderUsers()

    await screen.findAllByTestId("table-row")
    fireEvent.click(screen.getByRole("button", { name: "New user" }))
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "qa-created" } })
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "QA Created" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    expect(await screen.findByText("qa-created")).toBeTruthy()
    const register = state.calls.find((call) => call.url === "/api/auth/register")
    expect(register?.body).toEqual({
      username: "qa-created",
      password: "password123",
      display_name: "QA Created",
    })
    expect(state.calls.filter((call) => call.url === "/api/auth/users" && call.method === "GET")).toHaveLength(1)
  })
})
