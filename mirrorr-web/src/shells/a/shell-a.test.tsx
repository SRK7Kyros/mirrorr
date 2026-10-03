import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShellA } from "@/shells/a"

/**
 * Shell A smoke test — §3 anatomy contract, not a styling test.
 *
 * The shell is pure chrome: it must render its named regions even with no
 * session, no realtime socket and no view (the stage falls back to its own
 * placeholder). This guards the mount contract the orchestrator depends on.
 */

const navigateMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/sessions" } }),
}))

describe("ShellA", () => {
  it("renders the §3 regions and the stage as the scroll owner", () => {
    const { container } = render(<ShellA>view body</ShellA>)

    /* rail (desktop) and tab bar (compact) are the two labeled navs */
    expect(screen.getAllByRole("navigation", { name: "Primary" }).length).toBe(2)
    expect(container.querySelector(".nav-rail")).toBeTruthy()
    expect(container.querySelector(".shell-a__tabbar")).toBeTruthy()
    expect(screen.getByText("view body")).toBeTruthy()

    /* the single vertical scroll owner carries the stable id the skip link targets */
    const stage = container.querySelector(".stage")
    expect(stage).toBeTruthy()
    expect(stage?.getAttribute("id")).toBe("shell-a-stage")

    /* chrome regions */
    expect(container.querySelector(".shell-a__topbar")).toBeTruthy()
    expect(container.querySelector(".shell-a__backdrop")).toBeTruthy()
    expect(container.querySelector(".tally-band")).toBeTruthy()
  })

  it("lists the seven §3 nav surfaces in one rail", () => {
    render(<ShellA>{"view body"}</ShellA>)

    for (const label of [
      "Sessions",
      "Autoruns",
      "Recordings",
      "Profiles",
      "Plugins",
      "Import/Export",
      "Settings",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1)
    }
  })

  it("keeps the acrylic legal — no backdrop leaves no media behind the rail", () => {
    const { container } = render(<ShellA>{"view body"}</ShellA>)
    expect(container.querySelector(".shell-a__mesh")).toBeTruthy()
    expect(container.querySelector(".shell-a__media")).toBeNull()
  })

  it("renders the empty-database mesh as the default backdrop", async () => {
    const { container } = render(<ShellA>{"view body"}</ShellA>)
    const root = container.querySelector(".shell-a")
    expect(root?.getAttribute("data-backdrop")).toBe("on")
    expect(container.querySelector(".tally-plate--bare .tally-plate__surface")).toBeTruthy()
  })

  it("turns the backdrop off and on through the §2 switch", async () => {
    const { container } = render(<ShellA>{"view body"}</ShellA>)
    const root = container.querySelector(".shell-a")
    const toggle = screen.getByRole("button", { name: "Turn backdrop off" })

    await act(async () => {
      toggle.click()
    })
    expect(root?.getAttribute("data-backdrop")).toBe("off")
    expect(container.querySelector(".shell-a__backdrop-content")).toBeNull()
    expect(screen.getByText("backdrop off — opaque surfaces")).toBeTruthy()

    await act(async () => {
      screen.getByRole("button", { name: "Restore backdrop" }).click()
    })
    expect(root?.getAttribute("data-backdrop")).toBe("on")
  })
})
