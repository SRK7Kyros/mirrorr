import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { DropdownMenu, MenuItem, MenuSeparator } from "./Menu"

/**
 * One overflow menu for every card and row. Text items, destructive last below
 * a divider, 44 px trigger (visual 26 px). The point is that there is exactly
 * one place where "what can I do to this object" is declared — the surfaces
 * used to each hand-roll a trash icon beside an edit icon beside a third menu.
 */
export interface RowAction {
  readonly label: string
  readonly icon?: ReactNode
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onSelect: () => void
  /** Draw a divider above this item — use it before the destructive group. */
  readonly separatorBefore?: boolean
}

export function RowActions({
  label,
  actions,
  align = "right",
  placement = "down",
  className,
}: {
  readonly label: string
  readonly actions: readonly RowAction[]
  readonly align?: "left" | "right"
  readonly placement?: "down" | "up"
  readonly className?: string
}) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu label={label} align={align} placement={placement} className={className}>
      {actions.map((action) => (
        <div key={action.label} className="contents">
          {action.separatorBefore === true ? <MenuSeparator /> : null}
          <MenuItem
            icon={action.icon}
            danger={action.danger}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.label}
          </MenuItem>
        </div>
      ))}
    </DropdownMenu>
  )
}

/**
 * Selection control for the `header` slot: the card's `⋯` and, in select mode,
 * its checkbox. No checkbox at rest — a resting checkbox eats card width and
 * makes every card look editable.
 */
export function CardHeaderActions({
  selectLabel,
  selected,
  onToggleSelect,
  selectMode,
  children,
  className,
}: {
  readonly selectLabel: string
  readonly selected: boolean
  readonly onToggleSelect: () => void
  readonly selectMode: boolean
  readonly children?: ReactNode
  readonly className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      {selectMode ? (
        <label className="inline-flex size-6 items-center justify-center p-0">
          <input
            type="checkbox"
            className="check-input tab-stop"
            aria-label={selectLabel}
            checked={selected}
            onChange={onToggleSelect}
          />
        </label>
      ) : null}
      {children}
    </div>
  )
}
