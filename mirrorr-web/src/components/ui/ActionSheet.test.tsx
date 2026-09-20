import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActionSheet } from "@/components/ui/ActionSheet"

function labels(): string[] {
  return within(screen.getByTestId("action-sheet"))
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
}

describe("ActionSheet", () => {
  it("renders the caller's action set and moves destructive entries last", () => {
    const items = [
      { id: "delete", label: "Delete", tone: "danger" as const, onSelect: vi.fn() },
      { id: "stop", label: "Stop", onSelect: vi.fn() },
      { id: "export", label: "Export", onSelect: vi.fn() },
    ]

    render(<ActionSheet open onClose={vi.fn()} title="Actions" items={items} />)

    expect(labels()).toEqual(["Stop", "Export", "Delete"])
  })

  it("runs the action and closes the sheet when an entry is chosen", () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()

    render(
      <ActionSheet
        open
        onClose={onClose}
        title="Actions"
        items={[{ id: "stop", label: "Stop", onSelect }]}
      />,
    )

    fireEvent.click(screen.getByTestId("action-sheet-stop"))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("renders nothing while closed", () => {
    render(<ActionSheet open={false} onClose={vi.fn()} title="Actions" items={[]} />)

    expect(screen.queryByTestId("action-sheet")).toBeNull()
  })
})
