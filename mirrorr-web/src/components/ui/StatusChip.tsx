import { getStatusDescriptor } from "@/lib/status-map"
import type { StatusTone } from "@/lib/status-map"
import {
  IconCheck,
  IconClock,
  IconHelp,
  IconPackage,
  IconPlay,
  IconRecord,
  IconRemux,
  IconStop,
  IconX,
} from "./icons"
import { Spinner } from "./Spinner"

export type { StatusKey } from "@/lib/status-map"

export interface StatusChipProps {
  /** A key from the spine's STATUS_MAP (never invented in a view). */
  readonly status: import("@/lib/status-map").StatusKey
  /** Display word; views may override (e.g. "Deleting…"). Tone/dot come from the spine. */
  readonly title: string
  /** Row cells prefer a compact chip without the aria-live chatter (§6.3). */
  readonly compact?: boolean
  /** Pass for parent-controlled labels (table cells: `aria-labelledby`). */
  readonly titleId?: string
  /** §6.3: focus ring when the chip navigates to detail. */
  readonly clickable?: boolean
}

/**
 * The §1.4 indicator hue per tone. Tones are the spine's `StatusTone`; the
 * mapping is the spec's table (indicator colours are the `-deep` set where the
 * base hue fails 3:1 on surface). The word always renders in `--color-text`.
 */
const TONE_ATTR: Record<StatusTone, string> = {
  primary: "primary",
  secondary: "secondary",
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
}

/**
 * The §1.4 icon shape per status. The spine carries `check`/`cross` for
 * completed/failed; the remaining shapes are the spec's table, owned here
 * because the spine does not model them.
 */
const STATUS_ICON: Record<import("@/lib/status-map").StatusKey, () => React.ReactElement> = {
  scheduled: () => <IconClock size={12} />,
  active: () => <IconPlay size={12} />,
  recording: () => <IconRecord size={12} />,
  terminating: () => <IconStop size={12} />,
  remuxing: () => <IconRemux size={12} />,
  finalizing: () => <IconPackage size={12} />,
  completed: () => <IconCheck size={12} />,
  failed: () => <IconX size={12} />,
  unknown: () => <IconHelp size={12} />,
}

/**
 * StatusChip — §6.3/§1.4: always the opaque chip twin. Icon + word doubling is
 * mandatory; the indicator hue rides a 3px left bar and the dot (never the
 * word — hard law 7). Tone, dot behaviour and the label all come from the
 * spine (`src/lib/status-map.ts`), so the 9-status binding has one source of
 * truth. `remuxing`/`finalizing`/`terminating` swap the dot for the spinner;
 * `recording` pulses (static under reduced motion); `unknown` is the hollow
 * ring with no hue.
 */
export function StatusChip({ status, title, compact = false, titleId, clickable = false }: StatusChipProps) {
  const descriptor = getStatusDescriptor(status)
  const tone = TONE_ATTR[descriptor.tone]

  const indicator = (() => {
    if (descriptor.dot === "spinner") {
      return (
        <span className="status-chip__glyph">
          <Spinner size="sm" />
        </span>
      )
    }
    if (descriptor.dot === "pulse") {
      return <span className="status-chip__dot status-chip__dot--pulse" aria-hidden="true" />
    }
    return <span className="status-chip__dot" aria-hidden="true" />
  })()

  const classes = [
    "status-chip",
    compact ? "status-chip--compact" : null,
    clickable ? "status-chip--clickable" : null,
  ]
    .filter((part) => part !== null)
    .join(" ")

  return (
    <span
      className={classes}
      data-status={status}
      data-tone={tone}
      data-dot={descriptor.dot}
      aria-live={compact ? undefined : "polite"}
      aria-label={`Status: ${title}`}
      title={status === "unknown" ? title : undefined}
    >
      <span className="status-chip__bar" aria-hidden="true" />
      {indicator}
      <span className="status-chip__glyph" aria-hidden="true">
        {STATUS_ICON[status]()}
      </span>
      <span id={titleId} className="status-chip__label">
        {title}
      </span>
    </span>
  )
}
