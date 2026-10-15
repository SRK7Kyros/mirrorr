import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SessionStarting } from "./session-starting"

describe("SessionStarting", () => {
  it("announces once through a single live region", () => {
    render(<SessionStarting label="Waiting for stream…" />)

    const regions = screen.getAllByRole("status")
    expect(regions).toHaveLength(1)
    expect(regions[0]?.textContent).toBe("Waiting for stream…")
  })

  it("keeps the visible affordance out of the accessibility tree", () => {
    const { container } = render(<SessionStarting label="Initializing…" />)

    const decorative = container.querySelector(
      '[data-slot="session-starting"] > [aria-hidden="true"]',
    )
    expect(decorative).not.toBeNull()
  })
})
