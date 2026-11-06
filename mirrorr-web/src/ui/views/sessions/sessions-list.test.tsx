import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { Session } from "@/api/schemas"
import { SessionsListView } from "./sessions-list"

const router = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: {
    readonly to?: string
    readonly params?: unknown
    readonly children?: ReactNode
  }) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
}))

const list = vi.hoisted(() => ({
  items: [] as Session[],
}))

vi.mock("@/api", () => ({
  useEntityList: () => ({
    items: list.items,
    hasMore: false,
    isFetching: false,
    loadingAll: false,
    isLoading: false,
    isError: false,
    error: null,
    loadMore: vi.fn(),
    loadAll: async () => list.items,
    refetch: vi.fn(),
  }),
  useNameMaps: () => ({ engines: new Map(), resolvers: new Map(), profiles: new Map() }),
  deleteSession: vi.fn(() => Promise.resolve()),
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
  removeFromInfiniteLists: vi.fn(),
}))

vi.mock("@/api/endpoints", () => ({ fetchSessionPage: vi.fn() }))

vi.mock("@/api/hooks", () => ({
  useOverview: () => ({
    data: {
      sessions: { total: 2, live: 0, starting: 0, failed_24h: 0, notes: [] },
      next_autorun: null,
      disk: null,
    },
    isError: false,
  }),
}))

vi.mock("./new-session-dialog", () => ({ NewSessionDialog: () => null }))

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 7,
    engine_id: 1,
    resolver_id: 2,
    status: "completed",
    recording: false,
    started_at: "2026-10-09 17:00:00",
    ended_at: "2026-10-09 18:30:00",
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    profile_name: "news",
    session_urls: [],
    ...overrides,
  }
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionsListView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  list.items = [session(), session({ id: 8, status: "failed" })]
  router.navigate.mockClear()
})

describe("SessionsListView recipe", () => {
  it("gives every card the same declared height through one grid", () => {
    const { container } = renderList()
    const grid = container.querySelector<HTMLElement>('[data-slot="card-grid"]')

    expect(grid).not.toBeNull()
    expect(grid?.style.gridAutoRows).toBe("minmax(330px, auto)")

    const cards = [...(grid?.children ?? [])]
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      const article = card.querySelector<HTMLElement>('[data-slot="entity-card"]')
      expect(article).not.toBeNull()
      expect(article?.classList.contains("session-card")).toBe(true)
      expect(article?.querySelector('[data-slot="media-fill"]')).not.toBeNull()
    }
  })

  it("keeps checkboxes out of the resting card and turns them on from the toolbar", () => {
    renderList()
    expect(screen.queryByRole("checkbox", { name: "Select session #7" })).toBeNull()

    const toggle = screen.getByRole("button", { name: "Select" })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("checkbox", { name: "Select session #7" })).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "Select all sessions" })).toBeTruthy()
  })

  it("is a single-select status filter, not an additive set", () => {
    renderList()
    const filter = screen.getByRole("group", { name: "Filter by status" })

    expect(filter.textContent).toBe("AllLiveFinished")
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: "Live" }))

    expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false")
  })
})
