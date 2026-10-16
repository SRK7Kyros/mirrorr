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
