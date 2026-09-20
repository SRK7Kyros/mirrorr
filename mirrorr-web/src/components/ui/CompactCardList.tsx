/**
 * Compact card list — the ≤639px presentation swap for the list views
 * (spec L516 "card list, fixed anatomy" and L539-L541 "card tap opens the
 * detail; a single 44px ⋮ opens a bottom action sheet listing the same actions
 * as the desktop overflow menu").
 *
 * Presentation only (spec L535 "the desktop per-view specs remain
 * authoritative", L558 "ActionSheet is a presentation wrapper, not a new action
 * model"): the caller hands this component the same rows it gives the desktop
 * `Table` and derives each card's items from the same status-map factory the
 * desktop row renders, so the compact action set cannot drift from the desktop
 * one and a compact-only action cannot be invented.
 *
 * Geometry is spec L504/L516: every card clears 64px and the overflow button is
 * a 44×44px target (the compact floor lives in `styles.css`).
 */
import { MoreHorizontal } from "lucide-react"
import { useState, type ReactNode } from "react"
import { ActionSheet, type ActionSheetItem } from "@/components/ui/ActionSheet"

export interface CompactCardListProps<Row> {
  readonly label: string
  readonly rows: readonly Row[]
  readonly getRowKey: (row: Row) => string | number
  readonly renderCard: (row: Row) => ReactNode
  readonly actionsFor: (row: Row) => readonly ActionSheetItem[]
  readonly hrefFor?: (row: Row) => string
  readonly onOpen?: (row: Row) => void
  readonly openLabel?: (row: Row) => string
  readonly sheetTitle: (row: Row) => string
  readonly rowClassName?: (row: Row) => string | undefined
}

export function CompactCardList<Row>({
  label,
  rows,
  getRowKey,
  renderCard,
  actionsFor,
  hrefFor,
  onOpen,
  openLabel,
  sheetTitle,
  rowClassName,
}: CompactCardListProps<Row>) {
  const [openKey, setOpenKey] = useState<string | number | null>(null)
  const openRow = rows.find((row) => getRowKey(row) === openKey) ?? null

  return (
    <>
      <ul data-testid="compact-card-list" aria-label={label} className="flex flex-col gap-3">
        {rows.map((row) => {
          const actions = actionsFor(row)
          return (
            <li
              key={getRowKey(row)}
              data-testid="compact-card"
              className={[
                "flex min-h-16 items-stretch gap-1 rounded-surface border border-border bg-bg-raised p-4",
                rowClassName?.(row) ?? "",
              ]
                .join(" ")
                .trim()}
            >
              {hrefFor === undefined ? (
                <button
                  type="button"
                  aria-label={openLabel?.(row)}
                  data-testid="compact-card-open"
                  onClick={() => onOpen?.(row)}
                  className="flex flex-1 flex-col justify-center gap-2 rounded-control text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {renderCard(row)}
                </button>
              ) : (
                <a
                  href={hrefFor(row)}
                  data-testid="compact-card-open"
                  className="flex flex-1 flex-col justify-center gap-2 rounded-control focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {renderCard(row)}
                </a>
              )}
              {actions.length === 0 ? null : (
                <button
                  type="button"
                  data-testid="compact-card-overflow"
                  aria-label={sheetTitle(row)}
                  title="More actions"
                  aria-haspopup="dialog"
                  onClick={() => setOpenKey(getRowKey(row))}
                  className="flex size-11 shrink-0 items-center justify-center self-center rounded-control text-text-secondary hover:bg-bg-overlay focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <MoreHorizontal aria-hidden="true" className="size-5" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <ActionSheet
        open={openRow !== null}
        onClose={() => setOpenKey(null)}
        title={openRow === null ? "" : sheetTitle(openRow)}
        items={openRow === null ? [] : actionsFor(openRow)}
      />
    </>
  )
}
