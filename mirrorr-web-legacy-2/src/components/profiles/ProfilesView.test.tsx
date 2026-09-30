/**
 * V8 component tests — spec L323-L337 + D1 prefill: the profile list, the
 * editor driven by `config_schema` / `retry_modes_schema[mode]`, the
 * duplicate-name inline error, the 422 `resolver_config` field mapping, the
 * in-use pre-scan dialog and "Use" → D1 prefill.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProfilesView } from "@/components/profiles/ProfilesView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearAuthSession, setAuthSession } from "@/lib/auth-store"
import { EntityStore } from "@/lib/entity-store"
import type { Autorun } from "@/lib/schemas/autoruns"
import type { Engine, Profile, Resolver } from "@/lib/schemas/plugins"
import type { Session } from "@/lib/schemas/sessions"
import { clearToasts } from "@/lib/toast"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const ENGINE: Engine = {
  id: 1,
  name: "yt_dlp_piped",
  description: "yt-dlp + ffmpeg",
  origin: "yt_dlp_piped",
  origin_hash: "6e57c6e8db68009974221b4e9971df4c96ddd0973df779b6cc8d7512972f096b",
  capabilities: { can_record: true, can_playlist: true },
  retry_modes_schema: {
    none: { schema: { type: "object", properties: {} }, default_params: {} },
    count: {
      schema: { type: "object", properties: { count: { type: "integer", default: 3, minimum: 1 } }, required: ["count"] },
      default_params: { count: 3 },
    },
  },
}

const RESOLVER: Resolver = {
  id: 1,
  name: "static",
  description: "Static resolver",
  origin: "static",
  origin_hash: "f1c23535bececa4fe11b0b6bb681f66f902b87f40018143efc825274964305b9",
  config_schema: {
    type: "object",
    title: "StaticConfig",
    properties: {
      url: { type: "string", title: "Url" },
      headers: { type: "object", additionalProperties: { type: "string" }, default: {}, title: "Headers" },
    },
    required: ["url"],
  },
}

const PROFILE: Profile = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/original.m3u8" },
  retry_mode: "none",
  retry_config: {},
  requester_user_token: "admin",
}

const REFERENCING_AUTORUN: Autorun = {
  id: 11,
  user_friendly_name: "Nightly run",
  snake_case_name: "nightly_run",
  profile_id: 9,
  engine_id: 1,
  resolver_id: 1,
  status: "scheduled",
  start_time: "2030-07-15T15:12:00",
  end_time: "2030-07-15T16:12:00",
}

const OTHER_AUTORUN: Autorun = {
  ...REFERENCING_AUTORUN,
  id: 12,
  user_friendly_name: "Other run",
  snake_case_name: "other_run",
  profile_id: null,
}

const REFERENCING_SESSION: Session = {
  id: 21,
  profile_id: 9,
  engine_id: 1,
  resolver_id: 1,
  status: "completed",
}

const OTHER_SESSION: Session = {
  id: 22,
  profile_id: null,
  engine_id: 1,
  resolver_id: 1,
  status: "failed",
}

interface StubState {
  profiles: Profile[]
  autoruns: Autorun[]
  sessions: Session[]
  createError?: { status: number; body: unknown }
  postedProfileBody?: unknown
  putProfileBody?: unknown
  deletedProfileIds: number[]
  postedSessionBody?: unknown
  exportedUrls: string[]
}

function stubApi(state: StubState, profiles: readonly Profile[]) {
  state.profiles = [...profiles]
  return installFetch(async (url, init) => {
    const method = init?.method ?? "GET"
    if (url.startsWith("/api/import-export/")) {
      state.exportedUrls.push(url)
      return jsonResponse(200, { version: 1, exported_at: "2026-09-20T12:00:00", profiles: [PROFILE], autoruns: [] })
    }
    if (url.startsWith("/api/engines/")) {
      return jsonResponse(200, { items: [ENGINE], next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/resolvers/")) {
      return jsonResponse(200, { items: [RESOLVER], next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/profiles/") && method === "GET") {
      return jsonResponse(200, { items: state.profiles, next_cursor: null, has_more: false })
    }
    if (url === "/api/profiles/" && method === "POST") {
      state.postedProfileBody = JSON.parse(String(init?.body))
      if (state.createError !== undefined) {
        return jsonResponse(state.createError.status, state.createError.body)
      }
      const created = { ...PROFILE, id: 90, ...(state.postedProfileBody as object) }
      state.profiles = [...state.profiles, created]
      return jsonResponse(200, created)
    }
    if (url.startsWith("/api/profiles/") && method === "PUT") {
      state.putProfileBody = JSON.parse(String(init?.body))
      const id = Number(url.slice(url.lastIndexOf("/") + 1))
      const next = state.profiles.map((item) => (item.id === id ? { ...item, ...(state.putProfileBody as object) } : item))
      state.profiles = next
      return jsonResponse(200, next.find((item) => item.id === id))
    }
    if (url.startsWith("/api/profiles/") && method === "DELETE") {
      const id = Number(url.slice(url.lastIndexOf("/") + 1))
      state.deletedProfileIds.push(id)
      state.profiles = state.profiles.filter((item) => item.id !== id)
      return jsonResponse(200, { status: "deleted", deleted: { profiles: 1 } })
    }
    if (url.startsWith("/api/autoruns/")) {
      return jsonResponse(200, { items: state.autoruns, next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/sessions/") && method === "GET") {
      return jsonResponse(200, { items: state.sessions, next_cursor: null, has_more: false })
    }
    if (url === "/api/sessions/" && method === "POST") {
      state.postedSessionBody = JSON.parse(String(init?.body))
      return jsonResponse(200, { id: 77, engine_id: 1, resolver_id: 1, status: "active", recording: true })
    }
    return jsonResponse(404, { detail: `unexpected ${url}` })
  })
}

function renderView(highlight: number | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const store = new EntityStore({ queryClient: client })
  render(
    <QueryClientProvider client={client}>
      <ProfilesView store={store} highlight={highlight} />
      <ToastViewport />
    </QueryClientProvider>,
  )
  return store
}

function rowFor(name: string): HTMLTableRowElement {
  const cell = screen.getByText(name)
  const row = cell.closest("tr")
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  clearToasts()
  setAuthSession({ user: { id: 1, username: "admin", role: "admin", display_name: "Admin" } })
})

afterEach(() => {
  clearAuthSession()
})

describe("ProfilesView list", () => {
  it("renders the profile row with engine, resolver and retry mode", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView()

    await screen.findByText("p2")
    const row = rowFor("p2")
    expect(await within(row).findByText("yt_dlp_piped")).toBeDefined()
    expect(await within(row).findByText("static")).toBeDefined()
    expect(within(row).getByText("none")).toBeDefined()
    expect(await within(row).findByText("admin")).toBeDefined()
    expect(within(row).getByRole("button", { name: "Use" })).toBeDefined()
    expect(within(row).getByRole("button", { name: "Edit p2" })).toBeDefined()
    expect(within(row).getByRole("button", { name: "Delete p2" })).toBeDefined()
    expect(within(row).getByRole("button", { name: "Export p2" })).toBeDefined()
  })

  it("exports the row through the authenticated export endpoint", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Export p2" }))

    await waitFor(() => expect(state.exportedUrls).toEqual(["/api/import-export/profiles/9/export"]))
  })

  it("renders the empty state when there are no profiles", async () => {
    const state = emptyState()
    stubApi(state, [])
    renderView()

    expect(await screen.findByText("No profiles — save a reusable configuration")).toBeDefined()
  })

  it("highlights the ?highlight row", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView(9)

    expect((await screen.findByTestId("profile-name-9")).getAttribute("data-highlighted")).toBe("true")
  })
})

describe("ProfilesView editor", () => {
  it("creates a profile from the pickers and the dynamic resolver schema", async () => {
    const state = emptyState()
    stubApi(state, [])
    renderView()
    await screen.findByText("No profiles — save a reusable configuration")

    fireEvent.click(screen.getByRole("button", { name: "New profile" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "nightly" } })
    await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Resolver"), { target: { value: "1" } })
    fireEvent.change(await screen.findByLabelText("Url *"), { target: { value: "https://example.com/nightly.m3u8" } })
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }))

    await waitFor(() =>
      expect(state.postedProfileBody).toEqual({
        name: "nightly",
        default_engine_id: 1,
        resolver_id: 1,
        resolver_config: { headers: {}, url: "https://example.com/nightly.m3u8" },
        retry_mode: "none",
        retry_config: {},
      }),
    )
    expect(await screen.findByText("nightly")).toBeDefined()
  })

  it("re-renders the retry config form when the mode changes", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Edit p2" }))
    await waitFor(() => expect((screen.getByLabelText("Engine") as HTMLSelectElement).value).toBe("1"))
    fireEvent.change(screen.getByLabelText("Retry mode"), { target: { value: "count" } })

    expect(await screen.findByLabelText("Count *")).toBeDefined()
    expect((screen.getByLabelText("Count *") as HTMLInputElement).value).toBe("3")
  })

  it("edits a profile and refreshes the list", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Edit p2" }))
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement
    expect(nameInput.value).toBe("p2")
    fireEvent.change(nameInput, { target: { value: "p2 renamed" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(state.putProfileBody).toEqual({
        name: "p2 renamed",
        default_engine_id: 1,
        resolver_id: 1,
        resolver_config: { url: "https://example.com/original.m3u8" },
        retry_mode: "none",
        retry_config: {},
      }),
    )
    expect(await screen.findByText("p2 renamed")).toBeDefined()
  })

  it("maps a 422 resolver_config loc onto the specific field", async () => {
    const state = emptyState()
    state.createError = {
      status: 422,
      body: { detail: [{ loc: ["body", "resolver_config", "url"], msg: "field required" }] },
    }
    stubApi(state, [])
    renderView()
    await screen.findByText("No profiles — save a reusable configuration")

    fireEvent.click(screen.getByRole("button", { name: "New profile" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "nightly" } })
    await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Resolver"), { target: { value: "1" } })
    fireEvent.change(await screen.findByLabelText("Url *"), { target: { value: "https://example.com/nightly.m3u8" } })
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }))

    expect(await screen.findByText("field required")).toBeDefined()
  })

  it("shows the duplicate-name server error inline on the name field", async () => {
    const state = emptyState()
    state.createError = { status: 400, body: { detail: "A resource with that name already exists." } }
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "New profile" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "p2" } })
    await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Resolver"), { target: { value: "1" } })
    fireEvent.change(await screen.findByLabelText("Url *"), { target: { value: "https://example.com/dup.m3u8" } })
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }))

    const error = await screen.findByText("A resource with that name already exists.")
    const nameInput = screen.getByLabelText("Name")
    expect(error.getAttribute("id")).toBe(nameInput.getAttribute("aria-describedby"))
  })
})

describe("ProfilesView in-use pre-scan", () => {
  it("lists referencing autoruns and sessions before deleting", async () => {
    const state = emptyState()
    state.autoruns = [REFERENCING_AUTORUN, OTHER_AUTORUN]
    state.sessions = [REFERENCING_SESSION, OTHER_SESSION]
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Delete p2" }))

    expect(await screen.findByText("In use by 1 autoruns / 1 sessions")).toBeDefined()
    expect(screen.getByText("Nightly run")).toBeDefined()
    expect(screen.getByText("#21")).toBeDefined()
    expect(screen.queryByText("Other run")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }))
    await waitFor(() => expect(state.deletedProfileIds).toEqual([9]))
    expect(await screen.findByText("No profiles — save a reusable configuration")).toBeDefined()
  })

  it("falls back to the plain confirm when nothing references the profile", async () => {
    const state = emptyState()
    state.autoruns = [OTHER_AUTORUN]
    state.sessions = [OTHER_SESSION]
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Delete p2" }))

    expect(await screen.findByText('Delete "p2"?')).toBeDefined()
    expect(screen.queryByText(/In use by/)).toBeNull()
  })
})

describe("ProfilesView Use → D1 prefill", () => {
  it("opens the new-session dialog prefilled with the profile and submits profile_id", async () => {
    const state = emptyState()
    stubApi(state, [PROFILE])
    renderView()
    await screen.findByText("p2")

    fireEvent.click(screen.getByRole("button", { name: "Use" }))

    expect(await screen.findByTestId("new-session-form")).toBeDefined()
    await waitFor(() => expect((screen.getByLabelText("Profile") as HTMLSelectElement).value).toBe("9"))

    fireEvent.click(screen.getByRole("button", { name: "Start session" }))
    await waitFor(() =>     expect(state.postedSessionBody).toEqual({ profile_id: 9, recording: false }))
  })
})

function emptyState(): StubState {
  return { profiles: [], autoruns: [], sessions: [], deletedProfileIds: [], exportedUrls: [] }
}
