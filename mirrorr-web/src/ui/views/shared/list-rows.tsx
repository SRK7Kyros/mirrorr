import type { ReactNode } from "react"
import { Checkbox, IconChevronRight, Skeleton, Td } from "@/ui/components"

/**
 * Pieces the Profiles page's two stacked sections share.
 *
 * They live here rather than in `sources-panel.tsx` because the page owns the
 * one toolbar both lists read from: the sort vocabulary and the section head
 * have to be the same object on both halves, or the second section can drift
 * back to its own controls.
 */

/** The order both lists share — one control in the page toolbar sorts both. */
export type ListOrder = "newest" | "name" | "name-desc"

export const LIST_ORDERS: readonly { readonly value: ListOrder; readonly label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
]

/** A copy, sorted — callers keep the ranked array they were given. */
export function orderRows<T extends { readonly id: number; readonly name: string }>(
  rows: readonly T[],
  order: ListOrder,
): T[] {
  const sorted = [...rows]
  if (order === "name") sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (order === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name))
  else sorted.sort((a, b) => b.id - a.id)
  return sorted
}

/**
 * A section head whose count sits *beside* the `h2` instead of inside it.
 *
 * The count is a fact about the list, and folding it into the heading makes the
 * heading's accessible name change on every filter keystroke — a heading whose
 * name drifts cannot be navigated to by name.
 */
export function ListSectionHead({
  title,
  count,
  description,
  actions,
}: {
  readonly title: string
  readonly count: ReactNode
  readonly description: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
          <span className="text-sm text-dim tabular-nums">({count})</span>
        </div>
        <p className="mt-1 max-w-[68ch] text-md leading-normal text-ink-muted">{description}</p>
      </div>
      {actions !== undefined ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * Loading placeholder shaped like one of these tables — five columns of bars at
 * the row height the real table uses, so the section does not jump when the
 * response lands.
 */
export function ListSkeleton({ label, rows = 3 }: { readonly label: string; readonly rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-1 p-4"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-4">
          <Skeleton width="26%" height={12} />
          <Skeleton width="24%" height={12} />
          <Skeleton width="12%" height={12} />
          <Skeleton width="10%" height={12} />
          <Skeleton width="48px" height={12} className="ml-auto" />
        </div>
      ))}
    </div>
  )
}

/**
 * Select-all for one section. `indeterminate` is the honest state while only
 * some visible rows are picked — a plain unchecked box would claim nothing is
 * selected while a bulk bar says otherwise.
 */
export function SelectAllBox({
  label,
  checked,
  indeterminate,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly indeterminate: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <Checkbox
      aria-label={label}
      checked={checked}
      indeterminate={indeterminate}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

const TOGGLE_CLASS =
  "tab-stop inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-ink-dim " +
  "transition-[color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:bg-surface-3 hover:text-ink"

/**
 * One row expander. The config a row hides is too wide for its Name column, so
 * the panel is a second `<tr>` spanning the grid; a `<details>` cannot span
 * table rows, and this button is the disclosure it would have provided.
 */
export function DisclosureToggle({
  open,
  controls,
  label,
  onToggle,
}: {
  readonly open: boolean
  readonly controls?: string
  readonly label: string
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={TOGGLE_CLASS}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={label}
      onClick={onToggle}
    >
      <IconChevronRight
        size={14}
        className="transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] data-[open=true]:rotate-90"
        data-open={open}
      />
    </button>
  )
}

/** The expanded half of a row — the config the disclosure revealed. */
export function ConfigRow({
  id,
  columns,
  children,
}: {
  readonly id: string
  readonly columns: number
  readonly children: ReactNode
}) {
  return (
    <tr id={id} data-slot="row-config">
      <Td colSpan={columns} className="bg-surface-2">
        {children}
      </Td>
    </tr>
  )
}
