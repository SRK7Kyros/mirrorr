import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
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

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionDetailView sessionId="7" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  endpoints.fetchSession.mockReset()
  hls.loadSource.mockClear()
  hls.attachMedia.mockClear()
})

describe("SessionDetailView live sources", () => {
  it("shows the loading affordance and mounts no player while starting", async () => {
    for (const status of ["initializing", "stream_pending"]) {
      endpoints.fetchSession.mockResolvedValue(session({ status }))

      const { container, unmount } = renderDetail()

      const announcers = await screen.findAllByRole("status")
      expect(announcers).toHaveLength(1)
      expect(container.querySelector('[data-slot="session-starting"]')).not.toBeNull()
      expect(container.querySelector("video")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()
      expect(container.querySelector(".video-skin")).toBeNull()
      expect(container.querySelector(".session-preview")).toBeNull()

      // Stop is the only action during the gate.
      expect(screen.getByRole("button", { name: /stop session #7/i })).not.toBeNull()
      expect(screen.queryByRole("button", { name: /delete session #7/i })).toBeNull()

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

    await screen.findByRole("button", { name: /stop session #7/i })
    expect(container.querySelector('[data-slot="session-starting"]')).toBeNull()
    expect(container.querySelector(".video-skin")).not.toBeNull()
  })

  it("keeps the loading affordance and drops the 'not configured' copy when a starting session has no published URLs", async () => {
    for (const status of ["initializing", "stream_pending"]) {
      endpoints.fetchSession.mockResolvedValue(session({ status, session_urls: [] }))

      const { container, unmount } = renderDetail()

      await screen.findByRole("button", { name: /stop session #7/i })
      expect(container.querySelector('[data-slot="session-starting"]')).not.toBeNull()
      expect(screen.queryByText(/Live URLs not configured/i)).toBeNull()
      expect(container.querySelector(".url-list")).toBeNull()
      expect(container.querySelector("video")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()

      unmount()
    }
  })
})

describe("SessionDetailView timeline", () => {
  it("says the session has not started yet rather than showing an empty panel", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({ status: "active", capture_plan: [1], captures: [], attempts: [] }),
    )

    renderDetail()

    await screen.findByRole("button", { name: /stop session #7/i })
    expect(screen.getByText("Timeline")).not.toBeNull()
    expect(screen.queryByText(/Waiting for the supervisor/)).not.toBeNull()
  })

  it("nests a single source's attempt under its own capture, with nothing to fall back to", async () => {
    endpoints.fetchSession.mockResolvedValue(
      session({
        status: "completed",
        capture_plan: [1],
        captures: [{ index: 1, status: "completed", profile_id: 1, profile_name: "F1" }],
        attempts: [{ index: 1, capture: 1, started_at: "2026-10-13T21:09:00", ended_at: "2026-10-13T22:04:00" }],
      }),
    )

    renderDetail()

    await screen.findByText("Live sources")
    expect(screen.getByText("Timeline")).not.toBeNull()
    const group = screen.getByRole("list", { name: "Attempts in capture 1" })
    expect(group).not.toBeNull()
    expect(screen.queryByText("Fallback")).toBeNull()
    expect(screen.queryByText(/Falls back to/)).toBeNull()
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
          { index: 1, capture: 1, started_at: "2026-10-13T21:09:00", ended_at: "2026-10-13T21:12:00", reason: "engine died" },
        ],
      }),
    )

    renderDetail()

    await screen.findByRole("button", { name: /stop session #7/i })
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
          { index: 1, status: "failed", profile_id: 1, profile_name: "F1", reason: "stream never became playable" },
          { index: 2, status: "active", profile_id: 2, profile_name: "F1 UK", merged: true },
        ],
        attempts: [
          { index: 1, capture: 1, started_at: "2026-10-13T21:09:00", ended_at: "2026-10-13T21:12:00" },
          { index: 2, capture: 2, started_at: "2026-10-13T21:13:00", ended_at: null },
        ],
      }),
    )

    renderDetail()

    await screen.findByRole("button", { name: /stop session #7/i })
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
