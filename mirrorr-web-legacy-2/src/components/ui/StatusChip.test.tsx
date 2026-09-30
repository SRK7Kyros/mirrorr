import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/Button"
import { StatusChip } from "@/components/ui/StatusChip"
import { sessionActionsFor, STATUS_KEYS, type StatusAction } from "@/lib/status-map"

/**
 * The chip is the only status rendering (spec L404/L476) and the action set is
 * always produced by the map (spec L197) — never restated per view.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

/** Test-local consumer: the exact shape a view renders from sessionActionsFor. */
function SessionActions({ status, canRecord }: { readonly status: string; readonly canRecord?: boolean }) {
  const actions: readonly StatusAction[] = sessionActionsFor(status, { canRecord })
  return (
    <div>
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.kind === "danger" ? "danger" : "secondary"}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}

describe("StatusChip", () => {
  it("renders the map label, token classes and an aria-hidden dot — never colour alone", () => {
    render(<StatusChip status="recording" />)

    const chip = screen.getByTestId("status-chip")
    expect(chip.dataset.status).toBe("recording")
    expect(chip.textContent).toBe("Recording")
    expect(chip.className).toContain("text-danger-chip-text")
    expect(chip.className).toContain("bg-danger/12")

    const dot = screen.getByTestId("pulse-dot")
    expect(dot.getAttribute("aria-hidden")).toBe("true")
    expect(dot.className).toContain("animate-pulse-recording")
    expect(dot.className).toContain("bg-danger")
  })

  it("uses a static dot for active and the ✓/✕ glyphs for completed/failed", () => {
    const { rerender } = render(<StatusChip status="active" />)
    expect(screen.queryByTestId("pulse-dot")).toBeNull()
    expect(screen.getByTestId("status-chip").querySelector("span[aria-hidden='true']")).toBeTruthy()

    rerender(<StatusChip status="completed" />)
    expect(screen.getByTestId("status-chip").querySelector("svg")).toBeTruthy()
    expect(screen.getByTestId("status-chip").textContent).toBe("Completed")

    rerender(<StatusChip status="failed" />)
    expect(screen.getByTestId("status-chip").textContent).toBe("Failed")
    expect(screen.getByTestId("status-chip").querySelector("svg")).toBeTruthy()
  })

  it("marks a detail header chip as a polite live region on request", () => {
    render(<StatusChip status="active" live />)
    expect(screen.getByTestId("status-chip").getAttribute("aria-live")).toBe("polite")
  })

  it("renders the unknown entry, raw string in the tooltip, and a warn log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    render(<StatusChip status="component_bogus_status" />)

    const chip = screen.getByTestId("status-chip")
    expect(chip.dataset.status).toBe("unknown")
    expect(chip.textContent).toBe("Unknown")
    expect(chip.getAttribute("title")).toBe("component_bogus_status")
    expect(chip.className).toContain("text-neutral-chip-text")
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("renders every status in the map", () => {
    render(
      <div>
        {STATUS_KEYS.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </div>,
    )
    expect(screen.getAllByTestId("status-chip")).toHaveLength(9)
  })
})

describe("session action sets", () => {
  it("never renders a delete action for remuxing or finalizing", () => {
    for (const status of ["remuxing", "finalizing"]) {
      const { unmount } = render(<SessionActions status={status} />)
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
      unmount()
    }

    render(<SessionActions status="completed" />)
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("keeps the recording toggle visible but disabled when the engine cannot record", () => {
    render(<SessionActions status="active" canRecord={false} />)

    const toggle = screen.getByRole("button", { name: "Enable recording" })
    expect(toggle.hasAttribute("disabled")).toBe(true)
  })

  it("renders the terminating stop action disabled rather than hidden", () => {
    render(<SessionActions status="terminating" />)
    expect(screen.getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(true)
  })
})
