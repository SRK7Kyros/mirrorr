import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

/**
 * One line of counts and measurements — `6 sessions · 3 live · 1 failed ·
 * 60 GB free`. Replaces the strip of triplicated stat boxes and the runs of
 * numbers that used to share a row with no separators.
 *
 * The line always renders, even while a query is failing: an empty ops band is
 * indistinguishable from "nothing is running", which is a different claim.
 */
export function StatLine({
  items,
  className,
  label,
}: {
  readonly items: readonly ReactNode[]
  readonly className?: string
  readonly label?: string
}) {
  if (items.length === 0) return null
  return (
    <p
      data-slot="stat-line"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted", className)}
    >
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 ? (
            <span className="text-dim" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span className="tabular-nums">{item}</span>
        </span>
      ))}
    </p>
  )
}
