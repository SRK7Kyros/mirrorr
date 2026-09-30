import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CompactCardList } from "@/components/ui/CompactCardList"
import type { ActionSheetItem } from "@/components/ui/ActionSheet"

interface Row {
  readonly id: number
  readonly name: string
}

const ROWS: readonly Row[] = [
  { id: 1, name: "first" },
  { id: 2, name: "second" },
]

function renderList(actionsFor: (row: Row) => readonly ActionSheetItem[]) {
  return render(
    <CompactCardList<Row>
      label="Rows"
      rows={ROWS}
      getRowKey={(row) => row.id}
      renderCard={(row) => <span>{row.name}</span>}
      actionsFor={actionsFor}
      hrefFor={(row) => `/rows/${row.id}`}
      sheetTitle={(row) => `Row #${row.id} actions`}
    />,
  )
}

function noActions(): readonly ActionSheetItem[] {
  return []
}

describe("CompactCardList", () => {
  it("renders one card per row as a list and never a table", () => {
    renderList(noActions)

    expect(screen.getByTestId("compact-card-list").tagName).toBe("UL")
    expect(screen.getByTestId("compact-card-list").getAttribute("aria-label")).toBe("Rows")
    expect(screen.getAllByTestId("compact-card")).toHaveLength(2)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("clears the 64px floor and taps through to the row detail", () => {
    renderList(noActions)

    const card = screen.getAllByTestId("compact-card")[0]
    expect(card?.className).toContain("min-h-16")
    expect(within(card as HTMLElement).getByTestId("compact-card-open").getAttribute("href")).toBe("/rows/1")
  })

  it("omits the overflow button when a row exposes no action", () => {
    renderList(noActions)

    expect(screen.queryByTestId("compact-card-overflow")).toBeNull()
    expect(screen.queryByTestId("action-sheet")).toBeNull()
  })

  it("opens the bottom action sheet with exactly the row's items and runs the chosen one", () => {
    const stop = vi.fn()
    const remove = vi.fn()
    renderList(() => [
      { id: "stop", label: "Stop", onSelect: stop },
      { id: "delete", label: "Delete", tone: "danger", onSelect: remove },
    ])

    expect(screen.queryByTestId("action-sheet")).toBeNull()
    fireEvent.click(screen.getAllByTestId("compact-card-overflow")[0] as HTMLElement)

    const sheet = screen.getByTestId("action-sheet")
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Stop", "Delete"])

    fireEvent.click(within(sheet).getByTestId("action-sheet-stop"))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByTestId("action-sheet")).toBeNull()
  })
})
