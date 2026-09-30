import { Check, Loader2, X } from "lucide-react"
import { resolveStatus, type StatusColorToken, type StatusDot } from "@/lib/status-map"

/**
 * StatusChip — the only rendering of a status (spec L106 + the Status &
 * Lifecycle Map). Every chip pairs a coloured dot/icon with its text label, so
 * status is never colour-only (spec L476); the recording pulse supplements the
 * label. `live` adds `aria-live="polite"` for detail headers (spec L404/L475).
 */

const COLOUR_CLASSES: Record<StatusColorToken, string> = {
  "--ok": "border-ok/30 bg-ok/12 text-ok",
  "--danger": "border-danger/30 bg-danger/12 text-danger-chip-text",
  "--warn": "border-warn/30 bg-warn/12 text-warn",
  "--info": "border-info/30 bg-info/12 text-info",
  "--purple": "border-purple/30 bg-purple/12 text-purple",
  "--neutral": "border-neutral/30 bg-neutral/12 text-neutral-chip-text",
}

const DOT_CLASSES: Record<StatusColorToken, string> = {
  "--ok": "bg-ok",
  "--danger": "bg-danger",
  "--warn": "bg-warn",
  "--info": "bg-info",
  "--purple": "bg-purple",
  "--neutral": "bg-neutral",
}

export interface StatusChipProps {
  readonly status: string
  /** Detail headers announce status changes politely (spec L404). */
  readonly live?: boolean
  readonly className?: string
}

function StatusGlyph({ dot, colour }: { readonly dot: StatusDot; readonly colour: StatusColorToken }) {
  const iconClass = "size-[var(--icon-row)]"

  if (dot === "spinner") {
    return (
      <Loader2
        aria-hidden="true"
        strokeWidth={2}
        className={`${iconClass} animate-spin [animation-duration:var(--motion-spinner)]`}
      />
    )
  }
  if (dot === "check") {
    return <Check aria-hidden="true" strokeWidth={2} className={iconClass} />
  }
  if (dot === "cross") {
    return <X aria-hidden="true" strokeWidth={2} className={iconClass} />
  }

  const pulse = dot === "pulse"
  return (
    <span
      data-testid={pulse ? "pulse-dot" : undefined}
      aria-hidden="true"
      className={`size-1.5 rounded-pill ${DOT_CLASSES[colour]} ${pulse ? "animate-pulse-recording" : ""}`}
    />
  )
}

export function StatusChip({ status, live = false, className }: StatusChipProps) {
  const resolved = resolveStatus(status)

  return (
    <span
      data-testid="status-chip"
      data-status={resolved.key}
      aria-live={live ? "polite" : undefined}
      title={resolved.isUnknown ? resolved.raw : undefined}
      className={[
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-micro font-medium",
        COLOUR_CLASSES[resolved.entry.colorToken],
        className ?? "",
      ].join(" ")}
    >
      <StatusGlyph dot={resolved.entry.dot} colour={resolved.entry.colorToken} />
      {resolved.entry.label}
    </span>
  )
}
