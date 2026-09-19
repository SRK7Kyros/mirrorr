/**
 * V3 row-action and status contracts (spec L197-L221, L263-L273):
 * delete is never rendered on `remuxing`/`finalizing`; actions and labels
 * come from the status map; autorun rows link `/autoruns/{id}`; the store's
 * WS frame seam inserts/patches/removes rows; Stop escalates to the
 * "Still stopping…" + Force delete offer after ~10s without a WS snapshot;
 * a 502/504 shows the "Control unavailable" banner with Force delete.
 */
import type { InfiniteData } from "@tanstack/react-query"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionsView, STOP_ESCALATION_MS } from "@/components/sessions/SessionsView"
import { API_URL_ENV_VAR } from "@/config/env"
import { EntityStore } from "@/lib/entity-store"
import { queryKeys } from "@/lib/query-keys"
import type { CursorPage } from "@/lib/schemas/pagination"
import type { Session } from "@/lib/schemas/sessions"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const CATALOG_EMPTY = { items: [], next_cursor: null, has_more: false }

function enginePayload(canRecord: boolean) {
  return {
    items: [{ id: 1, name: "yt_dlp_piped", capabilities: { can_record: canRecord } }],
    next_cursor: null,
    has_more: false,
  }
}

function makeSession(overrides: Partial<Session> & { id: number }): Session {
  return { status: "completed", engine_id: 1, resolver_id: 1, ...overrides }
}

function infinite(items: readonly Session[]): InfiniteData<CursorPage<Session>, null> {
  return { pages: [{ items, next_cursor: null, has_more: false }], pageParams: [null] }
}

interface SetupOptions {
  readonly canRecord?: boolean
  readonly stop?: () => Response
}

function setup(rows: readonly Session[], options: SetupOptions = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const store = new EntityStore({ queryClient: client })
  client.setQueryData(queryKeys.sessions(), infinite(rows))

  const fetchMock = installFetch(async (url, init) => {
    const path = new URL(url, "http://localhost").pathname
    if (init?.method === "POST" && path.endsWith("/stop")) {
      return options.stop?.() ?? jsonResponse(200, { ok: true })
    }
    if (path.endsWith("/engines/")) return jsonResponse(200, enginePayload(options.canRecord ?? true))
    return jsonResponse(200, CATALOG_EMPTY)
  })

  render(
    <QueryClientProvider client={client}>
      <SessionsView store={store} />
    </QueryClientProvider>,
  )

  return { client, store, fetchMock }
}

function rowFor(id: number): HTMLElement {
  const cell = screen.getByText(`#${id}`)
  const row = cell.closest("tr")
  if (row === null) throw new Error(`row #${id} not found`)
  return row
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("row actions", () => {
  it("renders only the status map's actions and hides delete on remuxing", () => {
    setup([
      makeSession({ id: 128, status: "recording" }),
      makeSession({ id: 127, status: "remuxing" }),
      makeSession({ id: 126, status: "completed" }),
    ])

    const remuxing = rowFor(127)
    expect(within(remuxing).queryByRole("button")).toBeNull()
    expect(within(remuxing).queryByText("Delete")).toBeNull()
    expect(within(remuxing).getByTestId("status-chip").textContent).toBe("Remuxing")

    const recording = rowFor(128)
    expect(within(recording).getByRole("button", { name: "Stop" })).toBeTruthy()
    expect(within(recording).getByRole("button", { name: "Disable recording" })).toBeTruthy()
    expect(within(recording).queryByRole("button", { name: "Delete" })).toBeNull()

    const completed = rowFor(126)
    expect(within(completed).getByRole("button", { name: "Save as profile" })).toBeTruthy()
    expect(within(completed).getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("links rows created by an autorun to /autoruns/{id}", () => {
    setup([makeSession({ id: 125, status: "active", autorun_id: 5 })])

    const tag = within(rowFor(125)).getByTestId("autorun-tag")
    expect(tag.getAttribute("href")).toBe("/autoruns/5")
  })

  it("disables the recording action (with tooltip) when the engine cannot record", async () => {
    setup([makeSession({ id: 124, status: "active" })], { canRecord: false })

    const toggle = within(rowFor(124)).getByRole("button", { name: "Enable recording" })
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(true))
    expect(toggle.getAttribute("title")).toBe("Engine cannot record")
    expect(within(rowFor(124)).getByTestId("status-chip").textContent).toBe("Running")
  })
})

describe("entity store frames", () => {
  it("inserts, patches and removes rows through applyFrame", async () => {
    const { store } = setup([makeSession({ id: 1, status: "completed" })])

    await act(async () => {
      await store.applyFrame({
        event: "session.created",
        id: 200,
        data: { id: 200, status: "active", engine_id: 1, resolver_id: 1 },
      })
    })
    await waitFor(() => expect(within(rowFor(200)).getByTestId("status-chip").textContent).toBe("Running"))

    await act(async () => {
      await store.applyFrame({ event: "session.updated", id: 200, data: { id: 200, status: "failed" } })
    })
    await waitFor(() => expect(within(rowFor(200)).getByTestId("status-chip").textContent).toBe("Failed"))

    await act(async () => {
      await store.applyFrame({ event: "session.deleted", id: 200 })
    })
    await waitFor(() => expect(screen.queryByText(`#${200}`)).toBeNull())
    expect(screen.getAllByText("#1").length).toBeGreaterThan(0)
  })
})

describe("stop flow", () => {
  it("escalates to still-stopping + hard delete after 10s without a confirmation", async () => {
    vi.useFakeTimers()
    const { store } = setup([makeSession({ id: 42, status: "active", recording: true })])

    fireEvent.click(within(rowFor(42)).getByRole("button", { name: "Stop" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(store.getPending("session", 42)?.kind).toBe("stop")
    expect(within(rowFor(42)).getAllByText("Stopping…").length).toBeGreaterThan(0)

    act(() => {
      vi.advanceTimersByTime(STOP_ESCALATION_MS)
    })

    const escalation = screen.getByTestId("still-stopping")
    expect(escalation.textContent).toContain("Still stopping…")
    expect(within(escalation).getByRole("button", { name: "Force delete" })).toBeTruthy()
  })

  it("shows the control-unavailable banner + force delete on a 504", async () => {
    const { store } = setup([makeSession({ id: 42, status: "active" })], {
      stop: () => jsonResponse(504, { detail: "Session supervisor 42 is not responding" }),
    })

    fireEvent.click(within(rowFor(42)).getByRole("button", { name: "Stop" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }))

    const banner = await screen.findByTestId("control-unavailable-banner")
    expect(banner.textContent).toContain("Control unavailable — session may be stuck")
    expect(within(banner).getByRole("button", { name: "Force delete" })).toBeTruthy()
    expect(store.getPending("session", 42)).toBeUndefined()
  })
})
