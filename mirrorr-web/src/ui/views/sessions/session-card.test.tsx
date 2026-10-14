import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { NameMaps } from "@/api"
import type { Session } from "@/api/schemas"
import { SessionCard } from "./session-card"

const router = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
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

const api = vi.hoisted(() => ({
  useEngines: vi.fn(() => []),
  setSessionRecording: vi.fn(() => Promise.resolve()),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
  deleteSession: vi.fn(() => Promise.resolve()),
  stopSession: vi.fn(() => Promise.resolve()),
  saveSessionAsProfile: vi.fn(() => Promise.resolve()),
  removeFromInfiniteLists: vi.fn(),
}))

vi.mock("@/api", () => api)

vi.mock("hls.js", () => ({
  default: Object.assign(
    class {
      static isSupported(): boolean {
        return true
      }
      loadSource = vi.fn()
      attachMedia = vi.fn()
      destroy = vi.fn()
      on = vi.fn()
    },
    { Events: { MANIFEST_PARSED: "MANIFEST_PARSED" } },
  ),
}))

const names: NameMaps = { engines: new Map(), resolvers: new Map(), profiles: new Map() }

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 7,
    engine_id: 1,
    resolver_id: 2,
    status: "recording",
    recording: true,
    started_at: "2026-10-09 17:00:00",
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    profile_name: "news",
    session_urls: [{ label: "M3U8", url: "https://example.test/stream.m3u8" }],
    ...overrides,
  }
}

function renderCard(value: Session) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionCard session={value} names={names} selected={false} onToggle={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  router.navigate.mockClear()
  api.setSessionRecording.mockClear()
})

describe("SessionCard", () => {
  it("tapping preview pins playback without opening the session", () => {
    const { container } = renderCard(session())
    const preview = screen.getByRole("button", { name: /preview session #7/i })
    expect(container.querySelector(".session-preview")?.getAttribute("data-active")).toBe("false")

    fireEvent.click(preview)

    expect(container.querySelector(".session-preview")?.getAttribute("data-active")).toBe("true")
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it("tapping the preview video does not open the session", () => {
    const { container } = renderCard(session())
    const video = container.querySelector("video")
    expect(video).not.toBeNull()

    fireEvent.click(video as Element)

    expect(router.navigate).not.toHaveBeenCalled()
  })

  it("tapping the preview still does not open the session with no stream published", () => {
    const { container } = renderCard(session({ session_urls: [] }))
    const preview = container.querySelector(".session-preview")
    expect(preview).not.toBeNull()
    expect(screen.queryByRole("button", { name: /preview session #7|play session #7/i })).toBeNull()

    fireEvent.click(preview as Element)

    expect(router.navigate).not.toHaveBeenCalled()
  })

  it("opens the native player instead of the session when one is published", () => {
    const { container } = renderCard(
      session({
        session_urls: [
          { label: "HTML", url: "https://example.test/player.html?src=stream.m3u8" },
          { label: "M3U8", url: "https://example.test/stream.m3u8" },
        ],
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: /play session #7 with controls/i }))

    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector(".video-skin")).not.toBeNull()
    expect(container.querySelector(".video-skin video")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: /seek backward 10 seconds/i }),
    ).not.toBeNull()
    expect(router.navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /close session #7 player/i }))
    expect(container.querySelector(".video-skin")).toBeNull()
  })

  it("clicking anywhere else on the card opens the session", () => {
    const { container } = renderCard(session())

    const source = container.querySelector(".session-card-source")
    expect(source).not.toBeNull()
    fireEvent.click(source as Element)

    expect(router.navigate).toHaveBeenCalledWith({
      to: "/sessions/$sessionId",
      params: { sessionId: "7" },
    })
  })

  it("the recording toggle changes recording without opening the session", async () => {
    renderCard(session())
    const record = screen.getByRole("button", { name: "Recording" })
    expect(record.getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(record)

    await vi.waitFor(() => expect(api.setSessionRecording).toHaveBeenCalledWith(7, false))
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it("offers no recording toggle once the session is spent", () => {
    renderCard(session({ status: "completed", recording: false }))
    expect(screen.queryByRole("button", { name: /recording/i })).toBeNull()
  })
})
