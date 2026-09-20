/**
 * V5/D2 component tests — spec L279-L301, L402, L284-L287: the `+`-joined
 * filter chip grammar over loaded rows, spent rows at 60% opacity, the
 * client-composed run-now POST, the live delete warning, and the four-step
 * wizard's naive-UTC submission.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AutorunsView } from "@/components/autoruns/AutorunsView"
import { API_URL_ENV_VAR } from "@/config/env"
import { EntityStore } from "@/lib/entity-store"
import type { Autorun } from "@/lib/schemas/autoruns"
import { clearToasts, getToasts } from "@/lib/toast"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const SCHEDULED: Autorun = {
  id: 5,
  user_friendly_name: "Morning run",
  snake_case_name: "morning_run",
  profile_id: null,
  engine_id: 1,
  resolver_id: 1,
  resolver_config: {},
  retry_mode: "none",
  retry_config: {},
  status: "scheduled",
  start_time: "2030-07-15T15:12:00",
  end_time: "2030-07-15T16:12:00",
  recording: true,
}

const LIVE: Autorun = {
  ...SCHEDULED,
  id: 7,
  user_friendly_name: "Evening run",
  snake_case_name: "evening_run",
  status: "recording",
}

const SPENT: Autorun = {
  ...SCHEDULED,
  id: 6,
  user_friendly_name: "Old run",
  snake_case_name: "old_run",
  status: "failed",
}

const CREATED: Autorun = {
  ...SCHEDULED,
  id: 90,
  user_friendly_name: "Nightly run",
  snake_case_name: "nightly_run",
  profile_id: 9,
}

const PROFILE_ITEM = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/original.m3u8" },
  retry_mode: "none",
  retry_config: {},
}

interface StubState {
  readonly autoruns: readonly Autorun[]
  postedSessionBody?: unknown
  postedAutorunBody?: unknown
}

function stubApi(state: StubState) {
  return installFetch(async (url, init) => {
    if (url.startsWith("/api/autoruns/?") && init?.method !== "POST") {
      return jsonResponse(200, { items: state.autoruns, next_cursor: null, has_more: false })
    }
    if (url === "/api/autoruns/" && init?.method === "POST") {
      state.postedAutorunBody = JSON.parse(String(init.body))
      return jsonResponse(200, CREATED)
    }
    if (url.startsWith("/api/engines/")) {
      return jsonResponse(200, {
        items: [{ id: 1, name: "yt_dlp_piped", capabilities: { can_record: true } }],
        next_cursor: null,
        has_more: false,
      })
    }
    if (url.startsWith("/api/resolvers/")) {
      return jsonResponse(200, {
        items: [{ id: 1, name: "static", config_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }],
        next_cursor: null,
        has_more: false,
      })
    }
    if (url.startsWith("/api/profiles/")) {
      return jsonResponse(200, { items: [PROFILE_ITEM], next_cursor: null, has_more: false })
    }
    if (url === "/api/sessions/" && init?.method === "POST") {
      state.postedSessionBody = JSON.parse(String(init.body))
      return jsonResponse(200, { id: 77, engine_id: 1, resolver_id: 1, status: "active", recording: true, autorun_id: null })
    }
    if (url.startsWith("/api/autoruns/") && init?.method === "DELETE") {
      return jsonResponse(200, { deleted: 1 })
    }
    return jsonResponse(404, { detail: `unexpected ${url}` })
  })
}

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const store = new EntityStore({ queryClient: client })
  render(
    <QueryClientProvider client={client}>
      <AutorunsView store={store} />
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
})

describe("AutorunsView filter grammar", () => {
  it("defaults to scheduled+live, hides spent, and the chips re-join tokens", async () => {
    stubApi({ autoruns: [SCHEDULED, LIVE, SPENT] })
    renderView()

    await screen.findByText("Morning run")
    expect(screen.getByText("Evening run")).toBeDefined()
    expect(screen.queryByText("Old run")).toBeNull()

    fireEvent.click(screen.getByTestId("autorun-filter-spent"))
    await screen.findByText("Old run")
    expect(screen.getByText("Morning run")).toBeDefined()

    fireEvent.click(screen.getByTestId("autorun-filter-all"))
    await screen.findByText("Old run")
    expect(screen.getByTestId("autorun-filter-all").getAttribute("aria-pressed")).toBe("true")
  })

  it("renders spent rows at 60% opacity and live rows at full opacity", async () => {
    stubApi({ autoruns: [SCHEDULED, SPENT] })
    renderView()

    await screen.findByText("Morning run")
    fireEvent.click(screen.getByTestId("autorun-filter-spent"))
    await screen.findByText("Old run")

    expect(rowFor("Old run").className).toContain("opacity-60")
    expect(rowFor("Morning run").className).not.toContain("opacity-60")
  })
})

describe("AutorunsView run-now", () => {
  it("composes POST /sessions/ from the autorun and toasts", async () => {
    const state: StubState = { autoruns: [SCHEDULED] }
    stubApi(state)
    renderView()

    await screen.findByText("Morning run")
    fireEvent.click(screen.getByTestId("autorun-5-run-now"))

    await waitFor(() => expect(state.postedSessionBody).toBeDefined())
    expect(state.postedSessionBody).toEqual({
      engine_id: 1,
      resolver_id: 1,
      resolver_config: {},
      retry_mode: "none",
      retry_config: {},
      recording: true,
    })
    await waitFor(() => expect(getToasts().some((toast) => toast.message === "Session started")).toBe(true))
  })
})

describe("AutorunsView live delete warning", () => {
  it("warns that deleting a live autorun stops the recording", async () => {
    stubApi({ autoruns: [LIVE] })
    renderView()

    await screen.findByText("Evening run")
    fireEvent.click(screen.getByTestId("autorun-7-delete"))

    const warning = await screen.findByTestId("live-delete-warning")
    expect(warning.textContent).toContain("A recording is running — deleting will stop and delete it")
  })
})

describe("D2 wizard", () => {
  it("auto-slugs, warns on a past start, shows the UTC hint, and submits a naive-UTC body", async () => {
    const state: StubState = { autoruns: [] }
    stubApi(state)
    renderView()

    fireEvent.click(await screen.findByTestId("new-autorun-primary"))
    await screen.findByTestId("autorun-wizard-step")

    fireEvent.change(screen.getByTestId("autorun-name"), { target: { value: "Nightly run!" } })
    expect((screen.getByTestId("autorun-slug") as HTMLInputElement).value).toBe("nightly_run")

    fireEvent.click(screen.getByTestId("autorun-next"))
    expect(screen.getByTestId("autorun-wizard-step").textContent).toContain("Step 2 of 4")
    expect(screen.getByTestId("autorun-utc-hint").textContent).toBe("Your local time — stored as UTC")

    fireEvent.change(screen.getByTestId("autorun-start"), { target: { value: "2020-05-05T10:00" } })
    fireEvent.change(screen.getByTestId("autorun-end"), { target: { value: "2020-05-05T11:00" } })
    expect(screen.getByTestId("autorun-past-warning").textContent).toContain("backfill trigger")

    fireEvent.change(screen.getByTestId("autorun-start"), { target: { value: "2030-01-01T10:00" } })
    fireEvent.change(screen.getByTestId("autorun-end"), { target: { value: "2030-01-01T11:00" } })
    expect(screen.queryByTestId("autorun-past-warning")).toBeNull()

    fireEvent.click(screen.getByTestId("autorun-next"))
    expect(screen.getByTestId("autorun-wizard-step").textContent).toContain("Step 3 of 4")

    fireEvent.change(screen.getByTestId("autorun-profile"), { target: { value: "9" } })
    fireEvent.click(screen.getByTestId("autorun-next"))
    expect(screen.getByTestId("autorun-wizard-step").textContent).toContain("Step 4 of 4")
    expect(screen.getByTestId("autorun-review").textContent).toContain("One-off")

    fireEvent.click(screen.getByTestId("autorun-submit"))
    await waitFor(() => expect(state.postedAutorunBody).toBeDefined())

    const body = state.postedAutorunBody as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      "end_time",
      "profile_id",
      "recording",
      "snake_case_name",
      "start_time",
      "user_friendly_name",
    ])
    expect(body.snake_case_name).toBe("nightly_run")
    expect(body.profile_id).toBe(9)
    expect(String(body.start_time)).not.toMatch(/Z$/)
    expect(String(body.start_time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(String(body.end_time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })
})
