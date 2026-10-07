import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { pluralize } from "@/ui/lib/format"
import { Button } from "./Button"

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
    <div className={cn("bulk-bar", className)} role="region" aria-label="Bulk actions">
      <span className="bulk-count">{pluralize(count, "selected item")}</span>
      <div className="bulk-actions">{children}</div>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
