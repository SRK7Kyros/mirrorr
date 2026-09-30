import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/Button"
import { EMPTY_STATES, EmptyState } from "@/components/ui/EmptyState"
import { ERROR_PANEL_RETRY_LABEL, ErrorPanel } from "@/components/ui/ErrorPanel"
import { HEALTH_BANNER_COPY, HealthBanner } from "@/components/ui/HealthBanner"
import { SKELETON_PRESETS, SkeletonRows } from "@/components/ui/SkeletonRows"

/**
 * States contracts: exact per-view EmptyState copy (spec L269/L293/L317/L329/
 * L341/L380/L391), the single ErrorPanel with retry, HealthBanner copy (spec
 * L407/L171) and the skeleton presets (5 rows on V3, 8 cards on V7).
 */

const EXPECTED_EMPTY_COPY = {
  sessions: "No sessions yet — start your first recording",
  autoruns: "No autoruns — schedule a recording",
  recordings: "No recordings yet — enable recording on a session",
  profiles: "No profiles — save a reusable configuration",
  engines: "No engines installed",
  users: "No users",
  apiClients: "No API clients yet — create one for programmatic access",
} as const

describe("EmptyState", () => {
  it("exports the exact per-view copy strings", () => {
    expect(EMPTY_STATES).toEqual(EXPECTED_EMPTY_COPY)
  })

  it("renders the copy with an optional action", () => {
    render(
      <EmptyState
        title={EMPTY_STATES.sessions}
        action={<Button variant="primary">New session</Button>}
      />,
    )

    expect(screen.getByText(EXPECTED_EMPTY_COPY.sessions)).toBeTruthy()
    expect(screen.getByRole("button", { name: "New session" })).toBeTruthy()
  })

  it.each(Object.entries(EXPECTED_EMPTY_COPY))("renders the %s copy verbatim", (_key, copy) => {
    const { unmount } = render(<EmptyState title={copy} />)
    expect(screen.getByText(copy)).toBeTruthy()
    unmount()
  })
})

describe("ErrorPanel", () => {
  it("announces the failure and offers retry", () => {
    const onRetry = vi.fn()
    render(<ErrorPanel message="API unreachable" onRetry={onRetry} />)

    expect(screen.getByRole("alert").textContent).toContain("API unreachable")
    const retry = screen.getByRole("button", { name: ERROR_PANEL_RETRY_LABEL })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("renders without a retry control when no handler is given", () => {
    render(<ErrorPanel message="Unexpected server response" />)
    expect(screen.queryByRole("button", { name: ERROR_PANEL_RETRY_LABEL })).toBeNull()
  })
})

describe("SkeletonRows", () => {
  it("declares the sessions and recordings presets", () => {
    expect(SKELETON_PRESETS.sessions).toEqual({ variant: "rows", count: 5 })
    expect(SKELETON_PRESETS.recordings).toEqual({ variant: "cards", count: 8 })
  })

  it("renders 5 rows for the sessions preset", () => {
    render(
      <SkeletonRows variant={SKELETON_PRESETS.sessions.variant} count={SKELETON_PRESETS.sessions.count} />,
    )
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(5)
    expect(screen.getByTestId("skeletons").getAttribute("aria-busy")).toBe("true")
  })

  it("renders 8 cards for the recordings preset", () => {
    render(
      <SkeletonRows
        variant={SKELETON_PRESETS.recordings.variant}
        count={SKELETON_PRESETS.recordings.count}
      />,
    )
    expect(screen.getAllByTestId("skeleton-card")).toHaveLength(8)
    expect(screen.queryAllByTestId("skeleton-row")).toHaveLength(0)
  })
})

describe("HealthBanner", () => {
  it("renders the API-unreachable copy as a status region", () => {
    render(<HealthBanner variant="api" />)

    expect(screen.getByRole("status").textContent).toContain(HEALTH_BANNER_COPY.api)
    expect(HEALTH_BANNER_COPY.api).toBe("API unreachable — retrying")
  })

  it("renders the WS polling-fallback copy with retry", () => {
    const onRetry = vi.fn()
    render(<HealthBanner variant="socket" onRetry={onRetry} />)

    expect(screen.getByRole("status").textContent).toContain("Live updates offline — polling every 15s")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
