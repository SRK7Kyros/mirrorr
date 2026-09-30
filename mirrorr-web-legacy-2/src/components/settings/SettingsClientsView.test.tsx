import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsClientsView } from "@/components/settings/SettingsClientsView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import type { ApiClient } from "@/lib/schemas/auth"
import { queryClient } from "@/query-client"
import { installFetch, jsonResponse } from "@/test/api-helpers"
import { clearToasts } from "@/lib/toast"

const EXISTING: ApiClient = {
  id: 1,
  name: "ci-linux",
  is_active: true,
  created_at: "2026-09-20T01:14:21.893016",
}

const PLAINTEXT_KEY = "DTrbfen4MSDI-eOhl6j9KKZtopyJKhxlJHzkCY1vtE0"

interface StubState {
  clients: ApiClient[]
  calls: Array<{ url: string; method: string; body: unknown }>
}

function stubClients(initial: ApiClient[]): StubState {
  const state: StubState = { clients: [...initial], calls: [] }

  installFetch(async (url, init) => {
    const method = init?.method ?? "GET"
    state.calls.push({
      url,
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })

    if (url === "/api/auth/clients" && method === "GET") return jsonResponse(200, state.clients)
    if (url === "/api/auth/clients" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string }
      const client: ApiClient = {
        id: state.clients.length + 10,
        name: body.name,
        is_active: true,
        created_at: "2026-09-20T02:00:00",
      }
      state.clients = [...state.clients, client]
      return jsonResponse(200, { client, api_key: PLAINTEXT_KEY })
    }
    if (url.startsWith("/api/auth/clients/") && method === "DELETE") {
      const id = Number(url.slice("/api/auth/clients/".length))
      state.clients = state.clients.filter((client) => client.id !== id)
      return jsonResponse(200, { status: "deleted" })
    }
    return jsonResponse(404, { detail: `unstubbed ${method} ${url}` })
  })

  return state
}

function renderClients() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsClientsView />
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

describe("V13 explainer and table", () => {
  it("renders the exact explainer banner copy", async () => {
    stubClients([EXISTING])
    renderClients()

    expect((await screen.findByTestId("api-clients-banner")).textContent).toContain(
      "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications.",
    )
  })

  it("lists name, created and active columns", async () => {
    stubClients([EXISTING])
    renderClients()

    const row = (await screen.findAllByTestId("table-row"))[0] as HTMLElement
    expect(within(row).getByText("ci-linux")).toBeTruthy()
    expect(within(row).getByText(/2026/)).toBeTruthy()
    expect(within(row).getByTestId("client-active").textContent).toContain("Active")
  })

  it("shows the empty state copy when no clients exist", async () => {
    stubClients([])
    renderClients()

    expect(
      await screen.findByText("No API clients yet — create one for programmatic access"),
    ).toBeTruthy()
  })
})

describe("V13 create and reveal", () => {
  it("creates a key, reveals it once, copies it and forgets it on 'I've saved it'", async () => {
    const state = stubClients([])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
      renderClients()

    await screen.findByText("No API clients yet — create one for programmatic access")
    fireEvent.click(screen.getByRole("button", { name: "New key" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "deploy-bot" } })
    fireEvent.click(screen.getByRole("button", { name: "Create key" }))

    const revealed = await screen.findByTestId("api-key-reveal")
    expect(within(revealed).getByTestId("api-key-value").textContent).toContain(PLAINTEXT_KEY)
    expect(within(revealed).getByText("Shown once — store it now")).toBeTruthy()
    expect(state.calls.find((call) => call.method === "POST")?.body).toEqual({ name: "deploy-bot" })
    expect(screen.getByText("deploy-bot")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Copy key" }))
    expect(writeText).toHaveBeenCalledWith(PLAINTEXT_KEY)

    fireEvent.click(screen.getByRole("button", { name: "I've saved it" }))
    await waitFor(() => expect(screen.queryByTestId("api-key-reveal")).toBeNull())
    expect(document.body.textContent).not.toContain(PLAINTEXT_KEY)
  })

  it("toasts a create failure and never reveals a key", async () => {
    installFetch(async (_url, init) =>
      init?.method === "POST"
        ? jsonResponse(400, { detail: "A resource with that name already exists." })
        : jsonResponse(200, []),
    )
    renderClients()

    await screen.findByText("No API clients yet — create one for programmatic access")
    fireEvent.click(screen.getByRole("button", { name: "New key" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "dupe" } })
    fireEvent.click(screen.getByRole("button", { name: "Create key" }))

    expect(await screen.findByText("A resource with that name already exists.")).toBeTruthy()
    expect(screen.queryByTestId("api-key-reveal")).toBeNull()
  })
})

describe("V13 revoke", () => {
  it("requires the client name to be typed before revoking", async () => {
    const state = stubClients([EXISTING])
    renderClients()

    const row = (await screen.findAllByTestId("table-row"))[0] as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }))

    const confirm = screen.getByRole("button", { name: "Revoke key" })
    expect(confirm).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText("Type ci-linux to confirm"), { target: { value: "ci-linux" } })
    expect(confirm).toHaveProperty("disabled", false)
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.queryByText("ci-linux")).toBeNull())
    expect(state.calls.some((call) => call.url === "/api/auth/clients/1" && call.method === "DELETE")).toBe(true)
  })

  it("toasts a revoke failure", async () => {
    installFetch(async (_url, init) =>
      init?.method === "DELETE"
        ? jsonResponse(500, { detail: "Failed to delete client" })
        : jsonResponse(200, [EXISTING]),
    )
    renderClients()

    const row = (await screen.findAllByTestId("table-row"))[0] as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }))
    fireEvent.change(screen.getByLabelText("Type ci-linux to confirm"), { target: { value: "ci-linux" } })
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }))

    expect(await screen.findByText("Failed to delete client")).toBeTruthy()
  })
})
