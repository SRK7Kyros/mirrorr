import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import type { NameMaps } from "@/api"
import type { Autorun, Session } from "@/api/schemas"
import { formatCountdown, formatDateTime, formatTimeZoneLabel } from "@/api/time"
import { AutorunDetailBody } from "./autorun-detail"
import { AutorunConfigPanel } from "./autorun-detail-config"
import { LinkedRunPanel } from "./autorun-detail-linked-run"
import { AutorunNotices, autorunNotices } from "./autorun-detail-notices"
import { AutorunSchedulePanel, retirementCopy } from "./autorun-detail-schedule"

vi.mock("@tanstack/react-router", () => ({
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
 * The menu drags the edit dialog and the mutation client into a unit test that
 * is about the page's copy and layout. Its accessible name is the contract the
 * card and the fact inventory hold it to, so the stub keeps that.
 */
vi.mock("./autorun-actions", () => ({
  AutorunActionsMenu: ({ autorun }: { readonly autorun: Autorun }) => (
    <button type="button" aria-label={`Actions for ${autorun.user_friendly_name}`}>
      ⋯
    </button>
  ),
  sessionBodyFor: () => ({}),
}))

vi.mock("./autorun-form-dialog", () => ({
  AutorunFormDialog: () => null,
}))

const NOW = new Date("2026-10-12T09:30:00Z")
const START = "2026-10-15 09:00:00"
const END = "2026-10-15 11:00:00"

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
    start_time: START,
    end_time: END,
    recording: true,
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    profile_name: "F1 Weekend",
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 501,
    status: "completed",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 1,
    started_at: "2026-10-15 09:00:00",
    ended_at: "2026-10-15 11:00:00",
    ...overrides,
  } as Session
}

function renderBody(
  value: Autorun,
  {
    linked = null,
    sessions = { isLoading: false },
  }: { readonly linked?: Session | null; readonly sessions?: { isLoading?: boolean } } = {},
) {
  return render(
    <AutorunDetailBody
      autorun={value}
      names={names}
      now={NOW}
      linked={linked}
      sessions={sessions}
      runNowPending={false}
      onEdit={vi.fn()}
      onRunNow={vi.fn()}
    />,
  )
}

/** How many times `needle` is printed in the page's text. */
function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("AutorunDetailBody · header and one-fact-one-home", () => {
  it("leads with the back link, one h1, the chip and the two verbs", () => {
    const { container } = renderBody(autorun())

    expect(screen.getByRole("link", { name: "Back to autoruns" })).toBeDefined()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("F1 Race")
    expect(container.querySelectorAll("[data-status]")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Edit schedule" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Run now" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Actions for F1 Race" })).toBeDefined()
  })

  it("never labels the primary with a state", () => {
    renderBody(autorun())
    const primary = screen.getByRole("button", { name: "Edit schedule" })
    expect(primary.textContent?.toLowerCase()).not.toContain("scheduled")
    expect(primary.textContent?.toLowerCase()).not.toContain("completed")
  })

  it("says on Run now that the schedule still fires at its start time", () => {
    renderBody(autorun())
    const runNow = screen.getByRole("button", { name: "Run now" })
    expect(runNow.getAttribute("title")).toContain("still fires at its start time")
  })

  it("keeps the id and the slug in the header subtitle, and nothing the Config owns", () => {
    const { container } = renderBody(autorun())
    const subtitle = container.querySelector("h1 + p")
    expect(subtitle?.textContent).toContain("#201")
    expect(subtitle?.textContent).toContain("f1-race")
    expect(subtitle?.textContent).not.toContain("F1 Weekend")
    expect(subtitle?.textContent).not.toContain("Streamlink")
  })

  it("prints each config name exactly once on the whole page (AUT-08)", () => {
    const { container } = renderBody(autorun())
    const text = container.textContent ?? ""
    for (const value of ["F1 Weekend", "Streamlink", "Wide IPTV"]) {
      expect(count(text, value)).toBe(1)
    }
  })

  it("prints exactly three panels — Schedule, Config, Linked run — and no Status panel", () => {
    renderBody(autorun())
    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)
    expect(headings).toEqual(["Schedule", "Config", "Linked run"])
    expect(screen.queryByRole("heading", { name: "Status" })).toBeNull()
    expect(screen.queryByRole("heading", { name: /Config snapshot/i })).toBeNull()
  })

  it("prints start, end, countdown and the zone label once each (AUT-08)", () => {
    const { container } = renderBody(autorun())
    const text = container.textContent ?? ""
    const zone = formatTimeZoneLabel()

    expect(count(text, formatDateTime(START))).toBe(1)
    expect(count(text, formatDateTime(END))).toBe(1)
    expect(count(text, formatCountdown(START, NOW))).toBe(1)
    expect(count(text, zone)).toBe(1)
    expect(text).not.toContain("stored UTC")
  })

  it("states the one-shot rule in the Schedule panel", () => {
    const { container } = renderBody(autorun())
    expect(container.textContent).toContain("Runs once, then retires")
  })
})

describe("AutorunDetailBody · notices", () => {
  it("folds an issue and a passed start time into one ordered list", () => {
    const { container } = renderBody(
      autorun({ issue: "profile-deleted", start_time: "2026-10-12 09:00:00" }),
    )
    const lists = container.querySelectorAll('[data-slot="autorun-notices"]')
    expect(lists).toHaveLength(1)
    const items = lists[0]?.querySelectorAll("li") ?? []
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain("Its profile was deleted")
    expect(items[1]?.textContent).toContain("Its start time has already passed")
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("renders nothing when the record needs no preface", () => {
    const { container } = renderBody(autorun())
    expect(container.querySelector('[data-slot="autorun-notices"]')).toBeNull()
  })

  it("keeps a fixed severity order: blocked, late start, live run", () => {
    const items = autorunNotices({
      issue: {
        code: "profile-deleted",
        label: "Needs attention",
        title: "Its profile was deleted, so it will not run",
        detail: "Pick a profile and save.",
      },
      startPassed: true,
      live: true,
    })
    expect(items.map((item) => item.key)).toEqual(["issue:profile-deleted", "start-passed", "live-run"])
    expect(items.map((item) => item.tone)).toEqual(["warning", "warning", "info"])

    const { container } = render(<AutorunNotices items={items} />)
    expect(container.querySelectorAll("li")).toHaveLength(3)
  })

  it("does not restate the chip's word in any notice", () => {
    for (const item of autorunNotices({
      issue: null,
      startPassed: true,
      live: false,
    })) {
      expect(item.title.toLowerCase()).not.toBe("scheduled")
    }
  })
})

describe("AutorunDetailBody · config disclosure (AUT-08)", () => {
  it("collapses the copied config by default", () => {
    const { container } = renderBody(autorun())
    const disclosure = container.querySelector("details")
    expect(disclosure?.open).toBe(false)
  })

  it("opens the config with the reason when the autorun is flagged", () => {
    const { container } = renderBody(autorun({ issue: "profile-deleted" }))
    expect(container.querySelector("details")?.open).toBe(true)
    expect(container.textContent).toContain("Its profile was deleted, so it will not run")
  })

  it("keeps every config fact the old page printed", () => {
    const { container } = render(
      <AutorunConfigPanel
        autorun={autorun({ retry_mode: "aggressive" })}
        engine="Streamlink"
        resolver="Wide IPTV"
        profile="F1 Weekend"
        fallbacks={["Backup IPTV", "Spare Engine"]}
      />,
    )
    const text = container.textContent ?? ""
    for (const value of ["Streamlink", "Wide IPTV", "F1 Weekend", "On", "Backup IPTV → Spare Engine", "aggressive"]) {
      expect(text).toContain(value)
    }
  })
})

describe("LinkedRunPanel · AUT-09", () => {
  const neverEmpty = () => screen.queryByText(/No run yet|No run was recorded/)

  it("shows a skeleton while the query is loading, never the empty copy", () => {
    render(<LinkedRunPanel query={{ isLoading: true }} session={null} spent={false} />)
    expect(screen.getByRole("status", { name: "Loading" })).toBeDefined()
    expect(neverEmpty()).toBeNull()
  })

  it("shows an inline Retry on failure, never the empty copy", () => {
    render(
      <LinkedRunPanel
        query={{ isError: true, error: new Error("boom"), refetch: () => undefined }}
        session={null}
        spent={false}
      />,
    )
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined()
    expect(neverEmpty()).toBeNull()
  })

  it("shows the empty copy only after the query succeeded", () => {
    render(<LinkedRunPanel query={{ isLoading: false }} session={null} spent={false} />)
    expect(screen.getByText(/No run yet/)).toBeDefined()
  })

  it("links the run it spawned, with its own chip", () => {
    const { container } = render(
      <LinkedRunPanel query={{ isLoading: false }} session={session()} spent />,
    )
    expect(screen.getByRole("link", { name: "Session #501" })).toBeDefined()
    expect(screen.getByRole("link", { name: "Open session" })).toBeDefined()
    expect(container.querySelector('[data-status="completed"]')).not.toBeNull()
  })
})

describe("AutorunSchedulePanel", () => {
  it("drops the countdown once the window has opened", () => {
    const { container } = renderBody(
      autorun({ start_time: "2026-10-12 09:00:00", end_time: "2026-10-12 11:00:00" }),
    )
    expect(container.querySelector('[data-slot="countdown"]')).toBeNull()
    expect(container.textContent).not.toContain("starting…")
    expect(screen.getByText("Its start time has already passed")).toBeDefined()
  })

  it("names the retirement rule for every state", () => {
    expect(retirementCopy("upcoming")).toContain("Runs once, then retires")
    expect(retirementCopy("live")).toContain("Runs once, then retires")
    expect(retirementCopy("retired")).toContain("Ran once and retired")
    expect(retirementCopy("unknown")).toContain("does not repeat")
  })

  it("renders the window as one start/end/duration definition list", () => {
    const { container } = render(
      <AutorunSchedulePanel
        startTime={START}
        endTime={END}
        countdown="starts in ~3 d"
        retirement="upcoming"
      />,
    )
    const labels = Array.from(container.querySelectorAll("dt")).map((node) => node.textContent)
    expect(labels).toEqual(["Starts", "Ends", "Duration"])
    expect(container.querySelector('[data-slot="countdown"]')?.textContent).toBe("starts in ~3 d")
    expect(container.textContent).toContain("2:00:00")
  })
})

describe("AutorunDetailBody · state verbs", () => {
  it("offers no edit or run-now on a completed one-shot", () => {
    renderBody(autorun({ status: "completed" }))
    expect(screen.queryByRole("button", { name: "Edit schedule" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull()
    expect(screen.getByRole("button", { name: "Actions for F1 Race" })).toBeDefined()
  })

  it("warns that editing will not touch the live run, without contradicting the chip", () => {
    const { container } = renderBody(autorun({ status: "recording" }))
    expect(container.querySelector('[data-status="recording"]')).not.toBeNull()
    expect(container.textContent).toContain("Its run is live now")
    expect(container.textContent).not.toContain("will not run")
  })
})
