import { IconCheck, IconX } from "./icons"
import { Spinner } from "./Spinner"

export type StatusKey =
  | "scheduled"
  | "active"
  | "recording"
  | "terminating"
  | "remuxing"
  | "finalizing"
  | "completed"
  | "failed"
  | "unknown"

export interface StatusChipProps {
  readonly status: StatusKey
  /** Raw backend title, title-cased for display; unknown status warns once per raw key. */
  readonly title: string
  /** Row cells prefer a compact chip without the aria-live chatter (§4). */
  readonly compact?: boolean
  /** Pass for parent-controlled labels (table cells: `aria-labelledby`). */
  readonly titleId?: string
}

const warnedUnknownTitles = new Set<string>()

function warnUnknownOnce(title: string) {
  if (warnedUnknownTitles.has(title)) return
  warnedUnknownTitles.add(title)
  console.warn(`[status] unknown status: ${title}`)
}

/**
 * StatusChip — §4/§2: fills are 12% tints, fg + dot are the RE-BOUND hexes
 * (info→#7DB1E5, ok→#34D399, warn→#FBBF24, danger→#FF6B77, purple→#A7C0E0,
 * neutral→#9AA3B2) declared in tokens.css under `[data-status=…]`.
 * recording pulses its dot 1.6s; remuxing/finalizing swap the dot for the
 * 12px spinner in #A7C0E0; completed/failed get ✓/✕; unknown shows the raw
 * title in neutral with a one-time console.warn.
 */
export function StatusChip({ status, title, compact = false, titleId }: StatusChipProps) {
  if (status === "unknown") {
    warnUnknownOnce(title)
  }

  const glyph = (() => {
    if (status === "completed") {
      return (
        <span className="chip__glyph">
          <IconCheck size={12} />
        </span>
      )
    }
    if (status === "failed") {
      return (
        <span className="chip__glyph">
          <IconX size={12} />
        </span>
      )
    }
    if (status === "remuxing" || status === "finalizing") {
      return <Spinner size="sm" />
    }
    return <span className="chip__dot" aria-hidden="true" />
  })()

  return (
    <span
      className={compact ? "chip chip--compact" : "chip"}
      data-status={status}
      aria-live={compact ? undefined : "polite"}
      title={status === "unknown" ? title : undefined}
    >
      {glyph}
      {/* §1/§4: chip label is 12/500 Title Case — label-caps is <th>/legend only */}
      <span id={titleId} className="chip__label">
        {title}
      </span>
    </span>
  )
}
