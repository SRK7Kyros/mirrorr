import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"

/**
 * Dialog contracts: spec L111 (560px, wizards 720px, header 16px/600,
 * right-aligned footer), L112 (ConfirmDialog 400px, danger primary, typed
 * confirmation only for delete-user/revoke-key) and L405/L473 (focus trap,
 * Esc cancels, focus returns to the opener).
 */

function DialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New session"
        footer={<Button variant="primary">Create</Button>}
      >
        <p>Body copy</p>
      </Dialog>
    </>
  )
}

describe("Dialog", () => {
  it("is labelled, modal, 560px by default and 720px as a wizard", () => {
    const { unmount } = render(
      <Dialog open onClose={() => undefined} title="New session">
        <p>Body copy</p>
      </Dialog>,
    )
    const dialog = screen.getByRole("dialog", { name: "New session" })
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.className).toContain("max-w-[560px]")
    expect(dialog.className).toContain("bg-bg-overlay")
    unmount()

    render(
      <Dialog open onClose={() => undefined} title="Autorun" size="wizard">
        <p>Step one</p>
      </Dialog>,
    )
    expect(screen.getByRole("dialog", { name: "Autorun" }).className).toContain("max-w-[720px]")
  })

  it("traps focus, closes on Escape and returns focus to the opener", () => {
    render(<DialogHarness />)
    const opener = screen.getByRole("button", { name: "Open dialog" })
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole("dialog", { name: "New session" })
    const close = screen.getByRole("button", { name: "Close dialog" })
    const create = screen.getByRole("button", { name: "Create" })

    // Focus enters the dialog on open.
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tab from the last focusable wraps to the first (trap, not escape).
    create.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(close)

    // Shift+Tab from the first wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(create)

    // Esc cancels and focus returns to the opener.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("cancels through the overlay", () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="New session">
        <p>Body copy</p>
      </Dialog>,
    )
    fireEvent.click(screen.getByTestId("dialog-overlay"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("ConfirmDialog", () => {
  it("is 400px with a danger primary and no typed confirmation by default", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Stop session #4?"
        body={<p>The recording will finalize.</p>}
        confirmLabel="Stop"
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )

    const dialog = screen.getByRole("dialog", { name: "Stop session #4?" })
    expect(dialog.className).toContain("max-w-[400px]")

    const confirm = screen.getByRole("button", { name: "Stop" })
    expect(confirm.className).toContain("bg-danger")
    expect(confirm.hasAttribute("disabled")).toBe(false)

    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("gates the destructive confirm behind the typed value (delete-user/revoke-key)", () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Delete user"
        body={<p>Permanently delete alice?</p>}
        confirmLabel="Delete user"
        typedConfirmation="alice"
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )

    const confirm = screen.getByRole("button", { name: "Delete user" })
    expect(confirm.hasAttribute("disabled")).toBe(true)

    fireEvent.change(screen.getByLabelText("Type alice to confirm"), { target: { value: "alic" } })
    expect(confirm.hasAttribute("disabled")).toBe(true)

    fireEvent.change(screen.getByLabelText("Type alice to confirm"), { target: { value: "alice" } })
    expect(confirm.hasAttribute("disabled")).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("cancels on Escape without confirming", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Delete session #9?"
        body={<p>This cannot be undone.</p>}
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
