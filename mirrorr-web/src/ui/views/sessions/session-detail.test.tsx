import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { Session } from "@/api/schemas"
import { SessionDetailView } from "./session-detail"

const api = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
    useNameMaps: vi.fn(() => ({
      engines: new Map(),
      resolvers: new Map(),
      profiles: new Map(),
    })),
    useEngines: vi.fn(() => []),
    saveSessionAsProfile: vi.fn(),
    setSessionRecording: vi.fn(),
    stopSession: vi.fn(),
    deleteSession: vi.fn(),
    removeFromInfiniteLists: vi.fn(),
    subscribeRemuxProgress: vi.fn(() => () => {}),
    subscribeSessionTelemetry: vi.fn(() => () => {}),
  }
})

vi.mock("@/api", () => api)

const endpoints = vi.hoisted(() => ({ fetchSession: vi.fn() }))
vi.mock("@/api/endpoints", () => endpoints)

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    to: _to,
    params: _params,
    children,
    ...rest
  }: {
    readonly to?: string
    readonly params?: unknown
    readonly children?: ReactNode
  }) => <a {...rest}>{children}</a>,
}))

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
}))

vi.mock("hls.js", () => ({
  default: Object.assign(
    class {
      static isSupported(): boolean {
        return true
      }
      loadSource = hls.loadSource
      attachMedia = hls.attachMedia
      destroy = hls.destroy
      on = hls.on
    },
    { Events: { MANIFEST_PARSED: "MANIFEST_PARSED" } },
  ),
}))

const M3U8 = "https://example.test/stream.m3u8"
const HTML = "https://example.test/player.html?src=stream.m3u8"

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 7,
    engine_id: 1,
    resolver_id: 2,
    status: "initializing",
    recording: false,
    started_at: null,
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    profile_name: "news",
    session_urls: [
      { label: "M3U8", url: M3U8 },
      { label: "HTML", url: HTML },
    ],
    ...overrides,
  }
}

function renderDetail(id = "7") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionDetailView sessionId={id} />
    </QueryClientProvider>,
  )
}

const stopButton = () => screen.findByRole("button", { name: /stop recording/i })

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  endpoints.fetchSession.mockReset()
  hls.loadSource.mockClear()
  hls.attachMedia.mockClear()
})

describe("SessionDetailView live sources", () => {
  it("shows the starting gate and mounts no player while starting", async () => {
    for (const status of ["initializing", "stream_pending"]) {
      endpoints.fetchSession.mockResolvedValue(session({ status }))

      const { container, unmount } = renderDetail()

      // Wait for the gate itself: while the query is in flight the page shows
      // skeleton status regions too, so counting status roles globally would
      // photograph the loading state instead of the affordance under test.
      await waitFor(() =>
        expect(container.querySelector('[data-slot="session-starting"]')).not.toBeNull(),
      )
      const gate = container.querySelector<HTMLElement>('[data-slot="session-starting"]')
      expect(gate).not.toBeNull()
      // The spinner inside the gate is aria-hidden, so exactly one status
      // region is exposed to assistive tech.
      expect(within(gate as HTMLElement).getAllByRole("status")).toHaveLength(1)
      expect(container.querySelector("video")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()
      expect(container.querySelector(".video-skin")).toBeNull()

      // Stop is the only primary action during the gate.
      expect(await stopButton()).not.toBeNull()

      // The published URLs stay visible from `initializing` onward.
      expect(screen.getAllByText(/stream\.m3u8/).length).toBeGreaterThan(0)

      unmount()
    }
    expect(hls.loadSource).not.toHaveBeenCalled()
    expect(hls.attachMedia).not.toHaveBeenCalled()
  })

  it("mounts the player once the stream is playable", async () => {
    endpoints.fetchSession.mockResolvedValue(session({ status: "active" }))

    const { container } = renderDetail()

    await stopButton()
    expect(container.querySelector('[data-slot="session-starting"]')).toBeNull()
    expect(container.querySelector(".video-skin")).not.toBeNull()
  })

  it("names the reason and its fix when a starting session has no published URLs (SDR-05)", async () => {
    for (const status of ["initializing", "stream_pending"]) {
      endpoints.fetchSession.mockResolvedValue(session({ status, session_urls: [] }))

      const { container, unmount } = renderDetail()

      await stopButton()
      expect(container.querySelector('[data-slot="session-starting"]')).not.toBeNull()
      // The old page printed an unfixable grey sentence here.
      expect(screen.queryByText(/Live URLs not configured/i)).toBeNull()
      expect(screen.getByText(/the engine has not published a web_url/i)).not.toBeNull()
      expect(screen.getByText(/An operator sets web_url in the deployment config/i)).not.toBeNull()
      expect(container.querySelector("video")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()

      unmount()
    }
  })
})

describe("SessionDetailView timeline", () => {
  it("says attempt 1 has not started rather than claiming a supervisor wait (SDR-01)", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({ status: "active", capture_plan: [1], captures: [], attempts: [] }),
    )

    renderDetail()

    await stopButton()
    expect(screen.getByText("Timeline")).not.toBeNull()
    expect(screen.getByText("Attempt 1 has not started yet.")).not.toBeNull()
  })

  it("nests a single source's attempt under its own capture, with nothing to fall back to", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "completed",
        capture_plan: [1],
        captures: [{ index: 1, status: "completed", profile_id: 1, profile_name: "F1" }],
        attempts: [
          {
            index: 1,
            capture: 1,
            started_at: "2026-10-13T21:09:00",
            ended_at: "2026-10-13T22:04:00",
          },
        ],
      }),
    )

    renderDetail()

    // A completed run has a file, so its conditioned panel is `Recording`.
    await screen.findByRole("heading", { name: "Recording" })
    expect(screen.getByText("Timeline")).not.toBeNull()
    const group = screen.getByRole("list", { name: "Attempts in capture 1" })
    expect(group).not.toBeNull()
    expect(screen.queryByText(/Falls back to/)).toBeNull()
    // Nothing live is left to claim on a terminal run.
    expect(screen.queryByRole("heading", { name: "Stream" })).toBeNull()
  })

  it("lists the capture that failed, its attempt, and the profile still owed", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "active",
        capture_plan: [1, 2],
        captures: [
          {
            index: 1,
            status: "failed",
            profile_id: 1,
            profile_name: "F1",
            reason: "stream never became playable",
          },
        ],
        attempts: [
          {
            index: 1,
            capture: 1,
            started_at: "2026-10-13T21:09:00",
            ended_at: "2026-10-13T21:12:00",
            reason: "engine died",
          },
        ],
      }),
    )

    renderDetail()

    await stopButton()
    expect(screen.getByText("Timeline")).not.toBeNull()
    expect(screen.getByText("F1")).not.toBeNull()
    expect(screen.getByText("stream never became playable")).not.toBeNull()
    expect(screen.getByText("engine died")).not.toBeNull()
    expect(screen.getByText(/Falls back to Profile 2/)).not.toBeNull()
  })

  it("shows a handover: the capture that dropped and the one that recorded", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "active",
        capture_plan: [1, 2],
        captures: [
          {
            index: 1,
            status: "failed",
            profile_id: 1,
            profile_name: "F1",
            reason: "stream never became playable",
          },
          { index: 2, status: "active", profile_id: 2, profile_name: "F1 UK", merged: true },
        ],
        attempts: [
          { index: 1, capture: 1, started_at: "2026-10-13T21:09:00", ended_at: "2026-10-13T21:12:00" },
          { index: 2, capture: 2, started_at: "2026-10-13T21:13:00", ended_at: null },
        ],
      }),
    )

    renderDetail()

    await stopButton()
    expect(screen.getByText("F1")).not.toBeNull()
    expect(screen.getByText("F1 UK")).not.toBeNull()
    expect(screen.getByText("Fallback")).not.toBeNull()
    expect(screen.getByText("In the recording")).not.toBeNull()
    expect(screen.getByRole("list", { name: "Attempts in capture 1" })).not.toBeNull()
    expect(screen.getByRole("list", { name: "Attempts in capture 2" })).not.toBeNull()
    expect(screen.getByText("superseded by #2")).not.toBeNull()
    expect(screen.queryByText(/Falls back to/)).toBeNull()
  })
})

describe("SessionDetailView states", () => {
  it("tells a bad link from a deleted run and never fetches a non-numeric id (SDR-06)", async () => {
    renderDetail("abc")

    expect(screen.getByText("That is not a session id")).not.toBeNull()
    expect(screen.getByText(/A session id is a number/)).not.toBeNull()
    expect(screen.queryByText(/Session gone/i)).toBeNull()
    expect(endpoints.fetchSession).not.toHaveBeenCalled()
  })

  it("keeps a 404 distinguishable from an invalid id (SDR-06)", async () => {
    endpoints.fetchSession.mockRejectedValue(new api.ApiError(404, "Not found"))

    renderDetail()

    await screen.findByText("Session #7 is not here")
    expect(screen.queryByText("That is not a session id")).toBeNull()
  })

  it("never prints the supervisor sentence or a live panel on a completed run (SDR-01)", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "completed",
        ended_at: "2026-10-13T22:04:00",
        capture_plan: [1],
        captures: [{ index: 1, status: "completed", profile_id: 1, profile_name: "news" }],
        attempts: [{ index: 1, capture: 1, started_at: "2026-10-13T21:09:00" }],
      }),
    )

    const { container } = renderDetail()

    await screen.findByRole("heading", { name: "Recording" })
    expect(screen.queryByText(/Waiting for the supervisor/i)).toBeNull()
    expect(screen.queryByText("Attempt 1 has not started yet.")).toBeNull()
    expect(screen.queryByRole("button", { name: /stop recording/i })).toBeNull()
    // The verb is the action, never the state.
    expect(screen.getByRole("link", { name: /open recording/i })).not.toBeNull()
    expect(container.querySelector('[data-slot="session-starting"]')).toBeNull()
  })

  it("gives a failure its reason and the fix, with Config already open (SDR-02)", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "failed",
        capture_plan: [1],
        captures: [
          {
            index: 1,
            status: "failed",
            profile_id: 1,
            profile_name: "news",
            reason: "stream never became playable",
          },
        ],
        attempts: [{ index: 1, capture: 1, started_at: "2026-10-13T21:09:00" }],
      }),
    )

    const { container } = renderDetail()

    await screen.findAllByText("stream never became playable")
    expect(screen.getAllByText("stream never became playable").length).toBeGreaterThan(1)
    expect(screen.getByText(/A failed run is final/)).not.toBeNull()
    expect(screen.queryByRole("button", { name: /^retry$/i })).toBeNull()
    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect((details as HTMLDetailsElement).open).toBe(true)
  })

  it("states that deleting a live run stops the recording first", async () => {
    endpoints.fetchSession.mockResolvedValue(session({ status: "active" }))

    renderDetail()

    await stopButton()
    fireEvent.click(screen.getByRole("button", { name: /more actions for news/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }))

    await screen.findByText(/Stops the recording, then deletes the run/i)
  })

  it("keeps the full chain in a collapsed Config disclosure and the subtitle to profile → engine (SDR-04)", async () => {
    endpoints.fetchSession.mockResolvedValue(session({ status: "active" }))

    const { container } = renderDetail()

    await stopButton()
    expect(screen.getByText("news → yt_dlp_piped")).not.toBeNull()
    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect((details as HTMLDetailsElement).open).toBe(false)
    expect(within(details as HTMLElement).getByText(/daddylive/)).not.toBeNull()
  })
})
