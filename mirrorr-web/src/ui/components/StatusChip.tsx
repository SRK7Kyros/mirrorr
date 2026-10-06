import { cn } from "@/ui/lib/cn"
import { getStatusDescriptor, type StatusDot as StatusDotKind, type StatusTone } from "@/api/status"
import { IconCheck, IconX } from "./icons"

/** Colour-free dot — `.status-dot[data-tone][data-dot]`. */
export function StatusDot({
  tone,
  dot = "static",
  className,
}: {
  readonly tone: StatusTone
  readonly dot?: StatusDotKind
  readonly className?: string
}) {
  return <span className={cn("status-dot", className)} data-tone={tone} data-dot={dot} aria-hidden="true" />
}

/**
 * Status chip — resolves any server status through `STATUS_MAP` so no view
 * invents labels or tones. The bar + icon double the colour signal (never
 * colour alone), per the design-system rule.
 */
export function StatusChip({ status, className }: { readonly status: string; readonly className?: string }) {
  const descriptor = getStatusDescriptor(status)
  return (
    <span className={cn("status-chip", className)} data-tone={descriptor.tone} data-status={status}>
      <span className="status-bar" aria-hidden="true" />
      {descriptor.icon !== undefined ? (
        <span className="status-icon" aria-hidden="true">
          {descriptor.icon === "check" ? <IconCheck size={13} /> : <IconX size={13} />}
        </span>
      ) : (
        <span className="status-icon" aria-hidden="true">
          <StatusDot tone={descriptor.tone} dot={descriptor.dot} />
        </span>
      )}
      <span className="status-word">{descriptor.label}</span>
    </span>
  )
}
