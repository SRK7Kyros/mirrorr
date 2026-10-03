import type { ReactNode, Ref } from "react"
import { Skeleton } from "./Skeleton"

export interface TableProps {
  readonly children: ReactNode
  /** Accessible table name; render a caption via `label`. */
  readonly label?: string
  readonly className?: string
}

/** Table — the opaque reading surface for every list (§2: lists are never acrylic). */
export function Table({ children, label, className }: TableProps) {
  const classes = className === undefined ? "data-table" : `data-table ${className}`
  return (
    <div className="table-wrap">
      <table className={classes} aria-label={label}>
        {children}
      </table>
    </div>
  )
}

/** TableHead — solid `secondary` bar with white label-caps cells (§11.8). */
export function TableHead({ children }: { readonly children: ReactNode }) {
  return <thead className="ta-head">{children}</thead>
}

export interface TableBodyProps {
  readonly children?: ReactNode
  /** §6.4 loading: 8 skeleton rows, header stays. */
  readonly loading?: boolean
  readonly columns: number
  /** §6.4 empty: the empty-state panel replaces the tbody contents. */
  readonly empty?: ReactNode
  /** §6.4 error: row-level error strip inside the body. */
  readonly error?: ReactNode
}

/**
 * TableBody — owns the §6.4 loading / error / empty states so views never
 * hand-roll them. Loading renders 8 skeleton rows shaped like the real row;
 * empty and error span the full column count. Precedence: loading → error →
 * empty → children.
 */
export function TableBody({ children, loading = false, columns, empty, error }: TableBodyProps) {
  if (loading) {
    return (
      <tbody className="ta-body">
        {Array.from({ length: 8 }, (_, index) => (
          <tr key={index} className="ta-row ta-row--skeleton">
            <td className="ta-cell" colSpan={columns}>
              <Skeleton geometry="row" />
            </td>
          </tr>
        ))}
      </tbody>
    )
  }

  if (error !== undefined) {
    return (
      <tbody className="ta-body">
        <tr className="ta-row ta-row--message">
          <td className="ta-cell" colSpan={columns}>
            {error}
          </td>
        </tr>
      </tbody>
    )
  }

  if (empty !== undefined) {
    return (
      <tbody className="ta-body">
        <tr className="ta-row ta-row--message">
          <td className="ta-cell" colSpan={columns}>
            {empty}
          </td>
        </tr>
      </tbody>
    )
  }

  return <tbody className="ta-body">{children}</tbody>
}

export interface TableRowProps {
  readonly children: ReactNode
  /** §6.4: selected = primary 2px left bar. */
  readonly selected?: boolean
  /** Pending actions freeze the cluster and show a pending chip. */
  readonly pending?: ReactNode
  /** Makes the whole row a tab stop (row link) with the two-layer ring. */
  readonly onActivate?: () => void
  readonly className?: string
  /**
   * Forwarded to the `<tr>`. Needed by `useHighlightRef` so a `?highlight=`
   * deep link can scroll and ring the target row itself rather than a cell.
   */
  readonly ref?: Ref<HTMLTableRowElement>
}

export function TableRow({ children, selected = false, pending, onActivate, className, ref }: TableRowProps) {
  const classes = ["ta-row", selected ? "ta-row--selected" : null, className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return (
    <tr
      ref={ref}
      className={classes}
      aria-selected={selected || undefined}
      tabIndex={onActivate !== undefined ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        onActivate === undefined
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onActivate()
              }
            }
      }
    >
      {children}
      {pending !== undefined ? (
        <td className="ta-cell ta-cell--pending" aria-live="polite">
          {pending}
        </td>
      ) : null}
    </tr>
  )
}

export interface TableCellProps {
  readonly children?: ReactNode
  /** §11.9: numeric cells are sans + tabular numerals, never mono. */
  readonly numeric?: boolean
  /** Code/id/hash chips may use mono (JetBrains Mono, §11.9). */
  readonly mono?: boolean
  readonly className?: string
  readonly colSpan?: number
}

export function TableCell({ children, numeric = false, mono = false, className, colSpan }: TableCellProps) {
  const classes = ["ta-cell", numeric ? "ta-cell--num" : null, mono ? "ta-cell--mono" : null, className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return (
    <td className={classes} colSpan={colSpan}>
      {children}
    </td>
  )
}

/**
 * RowActions — §6.4: the trailing cluster. Up to 2 direct secondary buttons
 * plus one OverflowMenu; actions absent from STATUS_MAP are not rendered at
 * all (§6.4/§11.17). Reveal-on-hover only; on coarse pointers the cluster
 * becomes always-visible icon buttons (base.css).
 */
export function RowActions({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const classes = className === undefined ? "row-actions" : `row-actions ${className}`
  return <div className={classes}>{children}</div>
}
