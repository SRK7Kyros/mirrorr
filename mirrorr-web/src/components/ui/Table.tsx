import type { ReactNode } from "react"

/**
 * Table — a real `<table>` (spec L109): 11px uppercase text-muted header,
 * 36px rows, row hover `bg-overlay`, border-bottom between rows and no
 * vertical lines. Generic over the row shape; cells own their content so views
 * render status chips and action sets through the shared primitives.
 */

export interface TableColumn<Row> {
  readonly key: string
  readonly header: string
  readonly align?: "left" | "right"
  readonly render: (row: Row) => ReactNode
}

export interface TableProps<Row> {
  readonly label: string
  readonly columns: readonly TableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly getRowKey: (row: Row) => string | number
}

export function Table<Row>({ label, columns, rows, getRowKey }: TableProps<Row>) {
  return (
    <div className="w-full overflow-x-auto rounded-surface border border-border">
      <table aria-label={label} className="w-full border-collapse text-body">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  "px-3 py-2 text-micro font-medium tracking-label text-text-muted uppercase",
                  column.align === "right" ? "text-right" : "text-left",
                ].join(" ")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              data-testid="table-row"
              className="h-9 border-b border-border transition-colors duration-[var(--motion-fast)] ease-out last:border-b-0 hover:bg-bg-overlay"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={["px-3", column.align === "right" ? "text-right" : "text-left"].join(" ")}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
