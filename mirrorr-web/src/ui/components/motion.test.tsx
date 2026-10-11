import { beforeAll, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Dialog } from "./Dialog"
import { Drawer } from "./Drawer"
import { MenuPopover } from "./Menu"
import { Segmented } from "./Tabs"
import { Fab } from "./Fab"

// Layout animations (layoutId) need ResizeObserver, which jsdom omits.
beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, configurable: true })
})

describe("Dialog", () => {
  it("folds its centring into the transform motion owns", () => {
    render(
      <Dialog open onClose={() => {}} title="Confirm">
        body
      </Dialog>,
    )
    const dialog = screen.getByRole("dialog")
    // CSS no longer centres `.dialog`; the -50%/-50% translate must live in the
    // inline transform motion writes, or the panel jumps to the top-left.
    expect(dialog.style.transform).toContain("-50%")
  })

  it("renders nothing while closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Confirm">
        body
      </Dialog>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("Drawer", () => {
  it("renders a slide-over panel while open", () => {
    render(
      <Drawer open onClose={() => {}} title="Filters">
        body
      </Drawer>,
    )
    expect(screen.getByRole("dialog")).not.toBeNull()
  })

  it("renders nothing while closed", () => {
    render(
      <Drawer open={false} onClose={() => {}} title="Filters">
        body
      </Drawer>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("MenuPopover", () => {
  it("mounts the popover with its placement while open", () => {
    render(
      <MenuPopover open placement="up">
        <span>item</span>
      </MenuPopover>,
    )
    expect(screen.getByRole("menu").className).toContain("bottom-[calc(100%_+_var(--s-2))]")
  })

  it("renders nothing while closed", () => {
    render(
      <MenuPopover open={false} placement="up">
        <span>item</span>
      </MenuPopover>,
    )
    expect(screen.queryByRole("menu")).toBeNull()
  })
})

describe("Segmented", () => {
  it("mounts one animated thumb on the active segment", () => {
    render(
      <Segmented
        items={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        active="a"
        onChange={() => {}}
      />,
    )
    const [alpha, beta] = screen.getAllByRole("tab")
    expect(alpha.querySelector(".segmented-thumb")).not.toBeNull()
    expect(beta.querySelector(".segmented-thumb")).toBeNull()
  })
})

describe("Fab", () => {
  it("exposes its label and renders as the floating action button", () => {
    render(<Fab label="New session" icon={<span />} />)
    const button = screen.getByRole("button", { name: "New session" })
    expect(button.className).toContain("fab")
  })
})
