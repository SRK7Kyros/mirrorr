import { cn } from "@/ui/lib/cn"
import { formatDateTime, formatTimeZoneLabel } from "@/api/time"

/**
 * A wall-clock datetime, rendered in the viewer's zone. It never claims a zone
 * it is not in: the old cards printed a local clock next to "stored UTC", which
 * is how an autorun was read an hour early during a DST change.
 *
 * Pair it with `TimeZoneNote` once per page — repeating the zone on every card
 * is noise; naming it nowhere is the bug.
 */
export function TimeText({
  value,
  className,
  withZone = false,
  fallback = "—",
}: {
  readonly value: string | Date | null | undefined
  readonly className?: string
  readonly withZone?: boolean
  readonly fallback?: string
}) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("text-dim", className)}>{fallback}</span>
  }
  return (
    <time
      className={cn("tabular-nums", className)}
      dateTime={typeof value === "string" ? value : value.toISOString()}
    >
      {formatDateTime(value)}
      {withZone ? <span className="ml-1 text-dim">{formatTimeZoneLabel()}</span> : null}
    </time>
  )
}

/** Once per page (usually in the toolbar): "Times in CEST". */
export function TimeZoneNote({ className, prefix = "Times in" }: { readonly className?: string; readonly prefix?: string }) {
  return (
    <span data-slot="time-zone-note" className={cn("text-sm text-dim whitespace-nowrap", className)}>
      {prefix} {formatTimeZoneLabel()}
    </span>
  )
}
