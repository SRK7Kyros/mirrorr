/**
 * V7 component tests — spec L303-L322 + L395: the card grid, the
 * link-out-only media policy (no embed), the once-per-session HEAD probe,
 * the `recording.created` toast with its Open action, the `recording.deleted`
 * card removal and the `?highlight` scroll/highlight window.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RecordingsView } from "@/components/recordings/RecordingsView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { EntityStore } from "@/lib/entity-store"
import { resetMediaProbeSession } from "@/lib/media-probe"
import type { Recording } from "@/lib/schemas/recordings"
import { clearToasts, getToasts } from "@/lib/toast"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const MEDIA_RECORDING: Recording = {
  id: 5,
  user_friendly_name: "Morning capture",
  snake_case_name: "morning_capture",
  content_url: "https://media.example.com/morning.m3u8",
  profile_name: "p2",
  engine_name: "yt_dlp_piped",
  resolver_name: "static",
  duration_seconds: 65,
  size_bytes: 12_900_000,
  created_at: "2026-09-19T10:00:00",
}

const otherRecording: Recording = {
  ...MEDIA_RECORDING,
  id: 6,
  user_friendly_name: "Evening capture",
  snake_case_name: "evening_capture",
  content_url: "https://media.example.com/evening.mp4",
}

const NO_MEDIA_RECORDING: Recording = {
  ...MEDIA_RECORDING,
  id: 7,
  user_friendly_name: "Silent capture",
  snake_case_name: "silent_capture",
  content_url: "",
}

interface StubState {
  recordings: Recording[]
  headCalls: string[]
  headStatus: number
}

function stubApi(state: StubState, items: readonly Recording[]) {
  state.recordings = [...items]
  return installFetch(async (url, init) => {
    if (url.startsWith("/api/recordings/?") && (init?.method ?? "GET") === "GET") {
      return jsonResponse(200, { items: state.recordings, next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/recordings/") && init?.method === "DELETE") {
      const id = Number(url.slice(url.lastIndexOf("/") + 1))
      state.recordings = state.recordings.filter((item) => item.id !== id)
      return new Response(null, { status: 204 })
    }
    if (init?.method === "HEAD") {
      state.headCalls.push(url)
      return new Response(null, { status: state.headStatus })
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
      <RecordingsView store={store} highlight={highlight} />
      <ToastViewport />
    </QueryClientProvider>,
  )
  return store
}

function cardFor(id: number): HTMLElement {
  return screen.getByTestId(`recording-card-${id}`)
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  clearToasts()
  resetMediaProbeSession()
  vi.restoreAllMocks()
})

describe("RecordingsView cards", () => {
  it("renders the recording identity, engine/resolver/profile names and metadata", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [MEDIA_RECORDING])
    renderView()

    await screen.findByText("Morning capture")
    const card = cardFor(5)
    expect(within(card).getByText("morning_capture")).toBeDefined()
    expect(within(card).getByText(/yt_dlp_piped/)).toBeDefined()
    expect(within(card).getByText(/static/)).toBeDefined()
    expect(within(card).getByText(/p2/)).toBeDefined()
    expect(within(card).getByText("1:05")).toBeDefined()
    expect(within(card).getByText(/MB/)).toBeDefined()
    expect(state.headCalls).toEqual([])
  })

  it("renders the empty state when there are no recordings", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [])
    renderView()

    expect(await screen.findByText("No recordings yet — enable recording on a session")).toBeDefined()
  })
})

describe("RecordingsView link-out-only media", () => {
  it("replaces Open with the muted hint when content_url is empty", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [NO_MEDIA_RECORDING])
    renderView()

    await screen.findByText("Silent capture")
    const card = cardFor(7)
    expect(within(card).getByText("Media not served on this install")).toBeDefined()
    expect(within(card).queryByRole("link", { name: "Open" })).toBeNull()
    expect(within(card).queryByRole("button", { name: /copy link/i })).toBeNull()
  })

  it("renders Open as a link-out anchor with a 44px target and copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [MEDIA_RECORDING])
    renderView()

    await screen.findByText("Morning capture")
    const open = within(cardFor(5)).getByRole("link", { name: "Open" })
    expect(open.getAttribute("href")).toBe(MEDIA_RECORDING.content_url)
    expect(open.getAttribute("target")).toBe("_blank")
    expect(open.getAttribute("rel")).toContain("noopener")
    expect(open.className).toContain("h-11")

    fireEvent.click(within(cardFor(5)).getByRole("button", { name: /copy link/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MEDIA_RECORDING.content_url))
    expect(getToasts().some((toast) => toast.message === "Link copied")).toBe(true)
  })
})

describe("RecordingsView delete", () => {
  it("confirms with the spec copy, DELETEs, and removes the card on recording.deleted", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    const fetchMock = stubApi(state, [MEDIA_RECORDING, otherRecording])
    const store = renderView()

    await screen.findByText("Morning capture")
    fireEvent.click(within(cardFor(5)).getByRole("button", { name: "Delete Morning capture" }))

    expect(await screen.findByText("Permanently deletes the file")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Delete recording" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/recordings/5", expect.objectContaining({ method: "DELETE" })),
    )
    expect(cardFor(5)).toBeDefined()

    await act(async () => {
      store.applyFrame({ event: "recording.deleted", id: 5 })
    })
    await waitFor(() => expect(screen.queryByTestId("recording-card-5")).toBeNull())
    expect(screen.getByTestId("recording-card-6")).toBeDefined()
  })
})

describe("RecordingsView realtime consequences", () => {
  it("toasts recording.created with an Open action carrying content_url", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [])
    const store = renderView()
    await screen.findByText("No recordings yet — enable recording on a session")

    await act(async () => {
      store.applyFrame({
        event: "recording.created",
        id: 9,
        data: {
          id: 9,
          user_friendly_name: "Fresh capture",
          snake_case_name: "fresh_capture",
          content_url: "https://media.example.com/fresh.m3u8",
        },
      })
    })

    await waitFor(() => {
      const toast = getToasts().find((item) => item.message === "Recording saved")
      expect(toast?.action).toEqual({ label: "Open", href: "https://media.example.com/fresh.m3u8" })
    })
    const action = screen.getByTestId("toast-action")
    expect(action.getAttribute("href")).toBe("https://media.example.com/fresh.m3u8")
  })
})

describe("RecordingsView reachability probe", () => {
  it("probes once per session on the first Open and toasts when unreachable", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 404 }
    stubApi(state, [MEDIA_RECORDING, otherRecording])
    const openSpy = vi.fn(() => null)
    vi.stubGlobal("open", openSpy)
    renderView()

    await screen.findByText("Morning capture")
    expect(state.headCalls).toEqual([])

    fireEvent.click(within(cardFor(5)).getByRole("link", { name: "Open" }))
    await waitFor(() => expect(state.headCalls).toEqual([MEDIA_RECORDING.content_url]))
    await waitFor(() =>
      expect(getToasts().some((toast) => toast.message === "Media not reachable — file may not be served")).toBe(true),
    )
    expect(openSpy).toHaveBeenCalledWith(MEDIA_RECORDING.content_url, "_blank", "noopener,noreferrer")

    fireEvent.click(within(cardFor(6)).getByRole("link", { name: "Open" }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(state.headCalls).toEqual([MEDIA_RECORDING.content_url])
  })
})

describe("RecordingsView highlight", () => {
  it("scrolls to and highlights the ?highlight target for two seconds", async () => {
    const state: StubState = { recordings: [], headCalls: [], headStatus: 200 }
    stubApi(state, [MEDIA_RECORDING, otherRecording])
    renderView(6)

    await screen.findByText("Evening capture")
    await waitFor(() => expect(cardFor(6).getAttribute("data-highlighted")).toBe("true"))
    expect(cardFor(5).getAttribute("data-highlighted")).toBeNull()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100))
    })
    expect(cardFor(6).getAttribute("data-highlighted")).toBeNull()
  })
})
