import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import type { NameMaps } from "@/api"
import type { Autorun } from "@/api/schemas"
import { formatCountdown, formatTimeZoneLabel, formatWindow } from "@/api/time"
import { AutorunCard } from "./autorun-card"

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

/**
 * The real menu drags the whole edit dialog (and its form machinery) into a
 * unit test that is about the card's slots. Its label is the contract the fact
 * inventory and the e2e suite hold it to, so the stub keeps that.
 */
vi.mock("./autorun-actions", () => ({
  AutorunActionsMenu: ({ autorun }: { readonly autorun: Autorun }) => (
    <button type="button" aria-label={`Actions for ${autorun.user_friendly_name}`}>
      ⋯
    </button>
  ),
}))

const NOW = new Date("2026-10-12T09:30:00Z")

const names: NameMaps = {
  engines: new Map([[1, "Streamlink"]]),
  resolvers: new Map([[1, "Wide IPTV"]]),
  profiles: new Map([[1, "F1 Weekend"]]),
}

function autorun(overrides: Partial<Autorun> = {}): Autorun {
  return {
    id: 201,
    user_friendly_name: "F1 Race",
    snake_case_name: "f1-race",
    profile_id: 1,
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    start_time: "2026-10-15 09:00:00",
    end_time: "2026-10-15 11:00:00",
    recording: true,
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    profile_name: "F1 Weekend",
    ...overrides,
  }
}

function renderCard(value: Autorun, { selectMode = false } = {}) {
  return render(
    <AutorunCard
      autorun={value}
      names={names}
      selected={false}
      selectMode={selectMode}
      onToggle={vi.fn()}
    />,
  )
}

const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`)

beforeEach(() => {
  // Only `Date` is faked: the countdown is a clock, not a timer the test drives.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  router.navigate.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("AutorunCard", () => {
  it("puts the countdown in the hero and the window block below it", () => {
    const { container } = renderCard(autorun())
    const hero = slot(container, "hero")

    expect(hero?.textContent).toBe(formatCountdown("2026-10-15 09:00:00", NOW))
    expect(hero?.textContent).toContain("starts in ~")
    // The old card printed the countdown *inside* the window panel; the panel is
    // now only the window, so the two never repeat each other.
    expect(slot(container, "detail")?.textContent).not.toContain("starts in ~")
  })

  it("never renders “starting…” prose as the hero", () => {
    const { container } = renderCard(autorun({ start_time: "2026-10-12 09:00:00", end_time: "2026-10-12 11:00:00" }))
    const hero = slot(container, "hero")

    expect(hero?.textContent).not.toContain("starting")
    // A window that has opened falls back to its length, which is still a fact.
    expect(hero?.textContent).toBe("2:00:00")
  })

  it("puts the flagged reason in the hero and the fix in the single detail block", () => {
    const { container } = renderCard(autorun({ issue: "profile-deleted" }))

    expect(slot(container, "hero")?.textContent).toBe("Its profile was deleted, so it will not run")
    // Exactly one detail block, and it is the window block — not a second card body.
    const details = container.querySelectorAll('[data-slot="detail"]')
    expect(details).toHaveLength(1)
    expect(details[0]?.textContent).toMatch(/clear the flag/i)

    // The window is not lost to the flag: its date and time are still there.
    const windowText = formatWindow("2026-10-15 09:00:00", "2026-10-15 11:00:00", NOW)
    expect(details[0]?.textContent).toContain(windowText?.date ?? "")
    expect(details[0]?.textContent).toContain(windowText?.time ?? "")
  })

  it("renders the window in local time with its own zone, never “stored UTC”", () => {
    const { container } = renderCard(autorun())
    const detail = slot(container, "detail")

    expect(detail?.textContent).toContain(formatTimeZoneLabel())
    expect(detail?.querySelector("[data-zone-label]")?.textContent).toBe(formatTimeZoneLabel())
    expect(detail?.textContent).toMatch(/\d{1,2}:\d{2}/)
    expect(detail?.textContent).toContain("2:00:00")
    expect(container.textContent).not.toContain("stored UTC")
  })

  it("shows one status chip, in the header, with the REC marker beside it", () => {
    const { container } = renderCard(autorun())
    const chips = container.querySelectorAll("[data-status]")

    expect(chips).toHaveLength(1)
    expect(chips[0]?.getAttribute("data-status")).toBe("scheduled")
    expect(slot(container, "header")?.contains(chips[0] ?? null)).toBe(true)
    expect(container.textContent).toContain("REC")
    expect(screen.getByRole("button", { name: "Actions for F1 Race" })).toBeDefined()
  })

  it("collapses the media slot: an autorun has nothing to play", () => {
    const { container } = renderCard(autorun())
    expect(slot(container, "media")).toBeNull()
  })

  it("keeps every identity fact the old card rendered", () => {
    const { container } = renderCard(autorun())

    expect(container.textContent).toContain("F1 Race")
    expect(container.textContent).toContain("f1-race")
    expect(container.textContent).toContain("Wide IPTV")
    expect(container.textContent).toContain("Streamlink")
    expect(container.textContent).toContain("F1 Weekend")
    expect(screen.getByRole("link", { name: "F1 Race" })).toBeDefined()
  })

  it("has no checkbox at rest and a labelled one in select mode", () => {
    const atRest = renderCard(autorun())
    expect(atRest.container.querySelector("input[type=checkbox]")).toBeNull()
    atRest.unmount()

    renderCard(autorun(), { selectMode: true })
    expect(screen.getByLabelText("Select F1 Race")).toBeDefined()
  })
})
