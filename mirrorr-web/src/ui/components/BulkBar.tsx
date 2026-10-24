import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { pluralize } from "@/ui/lib/format"
import { Button } from "./Button"

const BULK_BAR_CLASS =
  "sticky bottom-[calc(var(--s-3)_+_var(--safe-bottom))] z-[var(--z-sticky)] flex items-center gap-3 py-2 px-3 border [border-color:var(--accent-line)] rounded-md bg-surface-3 shadow-elev-md animate-[bulk-in_var(--dur-med)_var(--ease-out)] max-sm:bottom-[calc(var(--bottomnav-h)_+_var(--safe-bottom)_+_var(--s-5))]"

const BULK_COUNT_CLASS = "text-sm font-medium text-ink whitespace-nowrap"

const BULK_ACTIONS_CLASS = "flex flex-1 flex-wrap items-center gap-2"

export interface BulkBarProps {
  readonly count: number
  readonly onClear: () => void
  readonly children: ReactNode
  readonly className?: string
}

/**
 * Sticky action bar shown while a list has a non-empty selection. Actions are
 * passed as children; a count and a clear control are built in.
 */
export function BulkBar({ count, onClear, children, className }: BulkBarProps) {
  return (
    <div className={cn(BULK_BAR_CLASS, className)} role="region" aria-label="Bulk actions">
      <span className={BULK_COUNT_CLASS}>{pluralize(count, "selected item")}</span>
      <div className={BULK_ACTIONS_CLASS}>{children}</div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
