/**
 * V4 contracts (spec L267-L277, L179-L193, L208):
 * - delete is never rendered while `remuxing`/`finalizing`;
 * - an empty `session_urls` is a first-class "Live URLs unavailable" state;
 * - a non-empty `session_urls` renders labelled links + copy + open-in-new-tab;
 * - a data-less `session.updated` frame triggers exactly ONE refetch through the
 *   entity-store seam and does not clear the rendered view;
 * - invalid ids render "Session not found" with the back link.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionDetailView } from "@/components/sessions/SessionDetailView"
import { API_URL_ENV_VAR } from "@/config/env"
import { EntityStore, type EntityResource } from "@/lib/entity-store"
import { publishSessionFrame } from "@/lib/session-frames"
import type { Session } from "@/lib/schemas/sessions"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const CATALOG_EMPTY = { items: [], next_cursor: null, has_more: false }

function makeSession(overrides: Partial<Session> & { id: number }): Session {
  return {
    status: "completed",
    engine_id: 1,
    resolver_id: 1,
    session_urls: [],
    attempts: [],
    ...overrides,
  }
}

interface SetupOptions {
  readonly refetchEntity?: (resource: EntityResource, id: number) => Promise<void>
  readonly session?: Session
}

function setup(session: Session, options: SetupOptions = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  const store = new EntityStore({
    queryClient: client,
    refetchEntity: options.refetchEntity,
  })

  installFetch(async (url) => {
    const path = new URL(url, "http://localhost").pathname
    if (path.endsWith(`/sessions/${session.id}`)) return jsonResponse(200, session)
    if (path.endsWith("/engines/")) {
      return jsonResponse(200, {
        items: [{ id: 1, name: "yt_dlp_piped", capabilities: { can_record: true } }],
        next_cursor: null,
        has_more: false,
      })
    }
    return jsonResponse(200, CATALOG_EMPTY)
  })

  const navigate = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SessionDetailView sessionId={session.id} store={store} navigateToList={navigate} />
    </QueryClientProvider>,
  )

  return { client, store, navigate }
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("session detail actions", () => {
  it("hides delete while remuxing and finalizing", async () => {
    setup(makeSession({ id: 41, status: "remuxing" }))
    await screen.findByTestId("session-detail")
    expect(screen.queryByTestId("session-delete")).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.getByTestId("remux-progress-card")).toBeTruthy()
  })

  it("hides delete while finalizing", async () => {
    setup(makeSession({ id: 42, status: "finalizing" }))
    await screen.findByTestId("session-detail")
    expect(screen.queryByTestId("session-delete")).toBeNull()
  })

  it("offers delete on terminal statuses", async () => {
    setup(makeSession({ id: 43, status: "failed", attempts: [] }))
    await screen.findByTestId("session-detail")
    expect(screen.getByTestId("session-delete")).toBeTruthy()
  })
})

describe("live urls", () => {
  it("renders the empty-url state as first class copy", async () => {
    setup(makeSession({ id: 44, status: "failed", session_urls: [] }))
    await screen.findByTestId("session-detail")

    const empty = screen.getByTestId("live-urls-empty")
    expect(empty.textContent).toContain("Live URLs unavailable")
    expect(empty.textContent).toContain("web_url")
    expect(screen.queryByTestId("live-url-link")).toBeNull()
  })

  it("renders labelled links with copy and open-in-new-tab when urls exist", async () => {
    setup(
      makeSession({
        id: 45,
        status: "recording",
        session_urls: [{ m3u8: "https://example.test/live.m3u8" }],
      }),
    )
    await screen.findByTestId("session-detail")

    const link = screen.getByTestId("live-url-link")
    expect(link.getAttribute("href")).toBe("https://example.test/live.m3u8")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.textContent).toContain("Open in new tab")
    expect(screen.getByText("M3U8")).toBeTruthy()
    expect(screen.getByTestId("live-url-copy").textContent).toContain("Copy")
  })

  it("renders the config panel as read-only JSON", async () => {
    setup(
      makeSession({
        id: 46,
        status: "failed",
        resolver_config: { url: "https://example.test/x.m3u8" },
        retry_mode: "count",
        retry_config: { count: 3 },
      }),
    )
    await screen.findByTestId("session-detail")

    const panel = screen.getByTestId("config-panel")
    expect(panel.querySelectorAll("input, textarea, select").length).toBe(0)
    expect(screen.getByTestId("config-resolver").textContent).toContain("https://example.test/x.m3u8")
    expect(screen.getByTestId("config-retry").textContent).toContain('"count": 3')
  })
})

describe("ws frame seam", () => {
  it("a data-less session.updated refetches exactly once and keeps the view", async () => {
    const refetchEntity = vi.fn(async () => undefined)
    setup(makeSession({ id: 47, status: "active" }), { refetchEntity })
    await screen.findByTestId("session-detail")

    act(() => {
      publishSessionFrame({ event: "session.updated", id: 47 })
      publishSessionFrame({ event: "session.updated", id: 47 })
    })

    await waitFor(() => expect(refetchEntity).toHaveBeenCalledTimes(1))
    expect(refetchEntity).toHaveBeenCalledWith("session", 47)
    expect(screen.getByTestId("session-detail")).toBeTruthy()
    expect(screen.getByTestId("session-id").textContent).toBe("#47")
    expect(screen.getByTestId("status-chip").textContent).toBe("Running")
  })

  it("navigates to the list on session.deleted", async () => {
    const { navigate } = setup(makeSession({ id: 48, status: "failed" }))
    await screen.findByTestId("session-detail")

    act(() => {
      publishSessionFrame({ event: "session.deleted", id: 48 })
    })

    expect(navigate).toHaveBeenCalledWith("/sessions")
  })
})

describe("invalid id", () => {
  it("renders Session not found with a back link", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
    })
    const store = new EntityStore({ queryClient: client })
    installFetch(async () => jsonResponse(404, { detail: "not found" }))

    render(
      <QueryClientProvider client={client}>
        <SessionDetailView sessionId={Number.NaN} store={store} />
      </QueryClientProvider>,
    )

    const notFound = await screen.findByTestId("session-not-found")
    expect(notFound.textContent).toContain("Session not found")
    expect(screen.getByTestId("back-to-sessions").getAttribute("href")).toBe("/sessions")
  })
})
