import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StatusChip } from "@/components/ui/StatusChip"
import { Table, type TableColumn } from "@/components/ui/Table"

/**
 * Table contract (spec L109): a real `<table>`, 11px uppercase text-muted
 * header, 36px rows, hover `bg-overlay`, border-bottom rows, no vertical
 * lines. Real-browser computed geometry lives in tests/e2e/tokens.spec.ts.
 */

interface Row {
  readonly id: number
  readonly status: string
}

const ROWS: readonly Row[] = [
  { id: 1, status: "active" },
  { id: 2, status: "remuxing" },
]

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: "id", header: "Id", render: (row) => `#${row.id}` },
  { key: "status", header: "Status", render: (row) => <StatusChip status={row.status} /> },
]

describe("Table", () => {
  it("renders a real table with an accessible name and column headers", () => {
    render(<Table label="Sessions" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />)

    expect(screen.getByRole("table", { name: "Sessions" })).toBeTruthy()
    expect(screen.getAllByRole("row")).toHaveLength(3) // header + two data rows

    const header = screen.getByRole("columnheader", { name: "Status" })
    expect(header.getAttribute("scope")).toBe("col")
    expect(header.className).toContain("text-micro")
    expect(header.className).toContain("uppercase")
    expect(header.className).toContain("text-text-muted")
    expect(header.className).toContain("tracking-label")
  })

  it("renders 36px body rows with hover, bottom borders and no vertical lines", () => {
    render(<Table label="Sessions" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />)

    const rows = screen.getAllByTestId("table-row")
    expect(rows).toHaveLength(2)

    for (const row of rows) {
      expect(row.tagName).toBe("TR")
      expect(row.className).toContain("h-9")
      expect(row.className).toContain("border-b")
      expect(row.className).toContain("border-border")
      expect(row.className).toContain("hover:bg-bg-overlay")
      expect(row.className).toContain("last:border-b-0")
    }

    for (const cell of screen.getAllByRole("cell")) {
      expect(cell.tagName).toBe("TD")
      expect(cell.className).not.toContain("border-l")
      expect(cell.className).not.toContain("border-r")
    }
  })

  it("renders rows through the shared primitives", () => {
    render(<Table label="Sessions" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />)

    const chips = screen.getAllByTestId("status-chip")
    expect(chips.map((chip) => chip.dataset.status)).toEqual(["active", "remuxing"])
  })
})
