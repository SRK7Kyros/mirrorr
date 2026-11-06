import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
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

function renderCard(value: Session, selectMode = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionCard
        session={value}
        names={names}
        selected={false}
        selectMode={selectMode}
        onToggle={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  router.navigate.mockClear()
  api.setSessionRecording.mockClear()
  api.deleteSession.mockClear()
  hls.loadSource.mockClear()
  hls.attachMedia.mockClear()
})

describe("SessionCard slots", () => {
  it("renders the ordered slots with a filled 16:9 media box", () => {
    const { container } = renderCard(session())
    const card = container.querySelector("article.session-card")
    expect(card).not.toBeNull()

    for (const slot of ["header", "media", "hero", "identity", "footer"]) {
      expect(card?.querySelector(`[data-slot="${slot}"]`), `slot ${slot}`).not.toBeNull()
    }

    const fill = card?.querySelector('[data-slot="media"] [data-slot="media-fill"]')
    expect(fill?.getAttribute("data-fill")).toBe("frame")
    // The fact gate asserts a `[data-card-ignore]` element inside the media box.
    expect(card?.querySelector('[data-slot="media"] [data-card-ignore]')).not.toBeNull()
  })

  it("prints the id once and never repeats the profile as a second title", () => {
    renderCard(session())
    expect(screen.getAllByText("#7")).toHaveLength(1)
    // `news` is the title; the meta line may not print it again.
    expect(screen.getAllByText("news", { exact: true })).toHaveLength(1)
  })

  it("keeps the old live marker by naming the elapsed hero", () => {
    const { container } = renderCard(session())
    expect(screen.getByText("Live")).toBeTruthy()
    expect(container.querySelector('[data-slot="header"]')?.textContent).toContain("Recording")
  })

  it("gives a spent run a duration hero instead of an elapsed one", () => {
    renderCard(
      session({
        status: "completed",
        recording: false,
        started_at: "2026-10-09 17:00:00",
        ended_at: "2026-10-09 18:30:00",
      }),
    )
    expect(screen.getByText("1:30:00")).toBeTruthy()
    expect(screen.getByText("Recorded")).toBeTruthy()
    expect(screen.queryByText("Live")).toBeNull()
  })

  it("shows the select checkbox only in select mode", () => {
    const { unmount } = renderCard(session())
    expect(screen.queryByRole("checkbox", { name: "Select session #7" })).toBeNull()
    unmount()

    renderCard(session(), true)
    expect(screen.getByRole("checkbox", { name: "Select session #7" })).toBeTruthy()
  })
})

describe("SessionCard behaviour", () => {
  it("tapping preview pins playback without opening the session", () => {
    const { container } = renderCard(session())
    const preview = screen.getByRole("button", { name: /preview session news/i })
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

  it("mounts no player and shows the loading affordance while starting", () => {
    for (const status of ["initializing", "stream_pending"]) {
      const { container, unmount } = renderCard(session({ status }))

      expect(container.querySelector('[data-slot="session-starting"]')).not.toBeNull()
      expect(container.querySelector("video")).toBeNull()
      expect(container.querySelector("iframe")).toBeNull()
      expect(container.querySelector(".session-preview")).toBeNull()
      expect(container.querySelector(".video-skin")).toBeNull()

      unmount()
    }
    expect(hls.loadSource).not.toHaveBeenCalled()
    expect(hls.attachMedia).not.toHaveBeenCalled()
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

    fireEvent.click(screen.getByRole("button", { name: /play session news with controls/i }))

    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector(".video-skin")).not.toBeNull()
    expect(container.querySelector(".video-skin video")).not.toBeNull()
    expect(screen.getByRole("button", { name: /seek backward 10 seconds/i })).not.toBeNull()
    expect(router.navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /close session news player/i }))
    expect(container.querySelector(".video-skin")).toBeNull()
  })

  it("clicking the card body opens the session", () => {
    renderCard(session())

    fireEvent.click(screen.getByText(/daddylive/))

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

  it("keeps stop on the card body while the run is live, behind a named confirm", async () => {
    renderCard(session())
    fireEvent.click(screen.getByRole("button", { name: "Stop recording session #7" }))
    expect(router.navigate).not.toHaveBeenCalled()

    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("Stop recording session #7?")
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop recording" }))

    await vi.waitFor(() => expect(api.stopSession).toHaveBeenCalledWith(7))
  })

  it("moves delete into the ⋯ menu behind a confirm that names the session", async () => {
    renderCard(session({ status: "completed", recording: false }))

    fireEvent.click(screen.getByRole("button", { name: "Actions for session #7" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete session #7" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("Delete session #7?")

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    await vi.waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith(7))
    expect(router.navigate).not.toHaveBeenCalled()
  })
})
