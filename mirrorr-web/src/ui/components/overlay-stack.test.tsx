import { describe, expect, it, vi } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import { Dialog } from "./Dialog"
import { Drawer } from "./Drawer"

/**
 * A Drawer opened from inside a Dialog must win the Escape key: both listen on
 * `document`, so without the shared overlay stack a single Escape closed both.
 */
describe("overlay stack", () => {
  it("Escape closes only the top-most overlay, then the one underneath", () => {
    const onDialogClose = vi.fn()
    const onDrawerClose = vi.fn()

    const tree = (drawerOpen: boolean) => (
      <Dialog open onClose={onDialogClose} title="Outer">
        <Drawer open={drawerOpen} onClose={onDrawerClose} title="Inner">
          inner
        </Drawer>
      </Dialog>
    )

    // The drawer opens *after* the dialog, which is what makes it the top-most.
    const { rerender } = render(tree(false))
    rerender(tree(true))

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onDrawerClose).toHaveBeenCalledTimes(1)
    expect(onDialogClose).not.toHaveBeenCalled()

    rerender(tree(false))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onDialogClose).toHaveBeenCalledTimes(1)
  })
})