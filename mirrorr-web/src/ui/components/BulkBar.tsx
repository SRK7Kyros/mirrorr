import type { ReactNode } from "react"
import { useMediaQuery } from "@/ui/hooks"
import { cn } from "@/ui/lib/cn"
import { pluralize } from "@/ui/lib/format"
import { Button } from "./Button"
import { IconButton } from "./IconButton"
import { DropdownMenu, MenuItem } from "./Menu"
import { IconX } from "./icons"

/** Tailwind's `sm` edge, in rem so the browser's own text scaling moves with it. */
const PHONE_QUERY = "(max-width: 39.99rem)"

/** Actions a phone shows as icons before the rest move into the overflow menu. */
export const PHONE_INLINE_ACTIONS = 3

const BAR_CLASS =
  "sticky bottom-[calc(var(--s-3)_+_var(--safe-bottom))] z-[var(--z-sticky)] flex items-center gap-3 py-2 px-3 border [border-color:var(--accent-line)] rounded-md bg-surface-3 shadow-elev-md animate-[bulk-in_var(--dur-med)_var(--ease-out)]"

/**
 * A phone has no room for a row of labelled buttons, so a selection becomes a
 * floating pill at the + button's height: a count and icon-only actions. The
 * `nextToFab` variant stops where that button starts, so the two never overlap.
 */
const PILL_CLASS =
  "fixed left-[var(--s-4)] bottom-[calc(var(--bottomnav-h)_+var(--safe-bottom)_+var(--s-4))] z-[var(--z-sticky)] flex h-[52px] w-fit items-center gap-1 rounded-full border [border-color:var(--accent-line)] bg-surface-3 pl-2 pr-1.5 shadow-elev-md animate-[bulk-in_var(--dur-med)_var(--ease-out)]"

const PILL_BESIDE_FAB_CLASS = "max-w-[calc(100%-var(--s-4)-var(--s-4)-52px-var(--s-3))]"

const COUNT_BADGE_CLASS =
  "grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-full bg-[var(--accent-dim)] px-1.5 text-sm font-semibold tabular-nums text-brand"

const ACTIONS_CLASS = "flex flex-1 flex-wrap items-center gap-2"

export interface BulkAction {
  /** Stable identity across renders — a React key and the test's handle. */
  readonly key: string
  /** The action's words, which are also its accessible name. */
  readonly label: string
  readonly icon?: ReactNode
  readonly onClick?: () => void
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly loading?: boolean
}

export interface BulkBarProps {
  readonly count: number
  readonly onClear: () => void
  readonly actions: readonly BulkAction[]
  /**
   * The list's + button shares this corner on a phone, so the pill keeps clear
   * of its lane instead of running underneath it.
   */
  readonly nextToFab?: boolean
  readonly className?: string
}

/** One action on a phone: its icon, its words as the accessible name. */
function PhoneAction({ action }: { readonly action: BulkAction }): ReactNode {
  return (
    <IconButton
      label={action.label}
      icon={action.icon ?? <span className="text-sm">{action.label}</span>}
      size="lg"
      variant={action.danger === true ? "danger-ghost" : "ghost"}
      className="shrink-0 rounded-full"
      disabled={action.disabled === true || action.loading === true}
      onClick={action.onClick}
    />
  )
}

/**
 * Selection bar shown while a list has something selected. Actions arrive as
 * data rather than children: a phone draws them as a floating pill of icons and
 * moves whatever does not fit into a menu, while wider screens keep the row of
 * labelled buttons.
 */
export function BulkBar({ count, onClear, actions, nextToFab = false, className }: BulkBarProps) {
  const phone = useMediaQuery(PHONE_QUERY)

  if (phone) {
    // Reserving a slot for the menu means one fewer inline icon, which is what
    // keeps the pill clear of the + button at the narrowest phone width.
    const overflows = actions.length > PHONE_INLINE_ACTIONS
    const inline = actions.slice(0, overflows ? PHONE_INLINE_ACTIONS - 1 : PHONE_INLINE_ACTIONS)
    const overflow = actions.slice(inline.length)

    return (
      <div
        className={cn(PILL_CLASS, nextToFab && PILL_BESIDE_FAB_CLASS, className)}
        role="region"
        aria-label="Bulk actions"
        data-slot="bulk-bar"
      >
        <span className={COUNT_BADGE_CLASS} aria-hidden="true">
          {count}
        </span>
        <span className="sr-only">{pluralize(count, "selected item")}</span>
        {inline.map((action) => (
          <PhoneAction key={action.key} action={action} />
        ))}
        {overflow.length > 0 ? (
          <DropdownMenu label="More bulk actions" placement="up" align="right">
            {overflow.map((action) => (
              <MenuItem
                key={action.key}
                icon={action.icon}
                danger={action.danger}
                disabled={action.disabled === true || action.loading === true}
                onClick={action.onClick}
              >
                {action.label}
              </MenuItem>
            ))}
          </DropdownMenu>
        ) : null}
        <IconButton
          label="Clear selection"
          icon={<IconX size={16} />}
          size="lg"
          className="shrink-0 rounded-full"
          onClick={onClear}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(BAR_CLASS, className)}
      role="region"
      aria-label="Bulk actions"
      data-slot="bulk-bar"
    >
      <span className="text-sm font-medium whitespace-nowrap text-ink">
        {pluralize(count, "selected item")}
      </span>
      <div className={ACTIONS_CLASS}>
        {actions.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={action.danger === true ? "danger-ghost" : "outline"}
            icon={action.icon}
            loading={action.loading === true}
            disabled={action.disabled === true}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
