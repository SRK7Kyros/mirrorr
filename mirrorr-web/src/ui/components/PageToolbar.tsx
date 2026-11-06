import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

/**
 * The one toolbar per list page: segmented filter, search, sort, select and a
 * single count. It replaces the second search box, the duplicate refresh and
 * the loose status chips that used to live beside each list.
 *
 * ≥900 px it is one row with the search flexed in the middle; below that it
 * wraps and the search takes the full width, so a phone never gets a 90 px
 * input squeezed between two controls.
 */
export interface PageToolbarProps {
  readonly filters?: ReactNode
  readonly search?: ReactNode
  readonly sort?: ReactNode
  readonly select?: ReactNode
  readonly refresh?: ReactNode
  readonly count?: ReactNode
  /** Once per list: the zone every time on the page is shown in (`TimeZoneNote`). */
  readonly note?: ReactNode
  readonly className?: string
}

export function PageToolbar({
  filters,
  search,
  sort,
  select,
  refresh,
  count,
  note,
  className,
}: PageToolbarProps) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "flex flex-wrap items-center gap-2 max-[899px]:gap-2",
        className,
      )}
    >
      {filters !== undefined ? <div className="flex min-w-0 items-center gap-2">{filters}</div> : null}
      {search !== undefined ? (
        <div className="min-w-[200px] flex-1 max-[899px]:order-last max-[899px]:basis-full">{search}</div>
      ) : null}
      {sort !== undefined ? <div className="flex items-center gap-2">{sort}</div> : null}
      {count !== undefined ? (
        <span className="ml-auto shrink-0 text-sm text-dim tabular-nums">{count}</span>
      ) : null}
      {select !== undefined ? <div className="flex items-center gap-2">{select}</div> : null}
      {refresh !== undefined ? <div className="flex items-center gap-2">{refresh}</div> : null}
      {note !== undefined ? <div className="basis-full">{note}</div> : null}
    </div>
  )
}

export interface FilterOption<T extends string> {
  readonly id: T
  readonly label: string
  readonly disabled?: boolean
}

/**
 * Filter as segmented buttons, not tabs: these narrow a list in place, so
 * `aria-pressed` is the honest state. Tabs would promise a panel and announce
 * a section change that never happens.
 */
export function FilterSegmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  readonly items: readonly FilterOption<T>[]
  readonly value: T
  readonly onChange: (id: T) => void
  readonly ariaLabel: string
  readonly className?: string
}) {
  return (
    <div className={cn("segmented", className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="segmented-item tab-stop data-[active=true]:bg-surface-3"
          data-active={item.id === value}
          aria-pressed={item.id === value}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          <span className="segmented-label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}
