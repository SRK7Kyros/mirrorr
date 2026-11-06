import { elapsedSeconds, formatDuration } from "@/api/time"
import { Panel, PanelBody, PanelHead, TimeText } from "@/ui/components"
import { FactRow } from "./autorun-detail-facts"

/**
 * The one place an autorun's window is printed. The page used to show the same
 * start/end/countdown in a `Status` panel, again in `Schedule`, and a third time
 * in the config snapshot; this panel replaces all three (AUT-08).
 */
export type ScheduleRetirement = "upcoming" | "live" | "retired" | "unknown"

/** The one-shot rule, stated in the panel rather than in an intro paragraph. */
export function retirementCopy(kind: ScheduleRetirement): string {
  switch (kind) {
    case "upcoming":
    case "live":
      return "Runs once, then retires — nothing repeats it."
    case "retired":
      return "Ran once and retired — create a new autorun to run it again."
    default:
      return "Runs once and does not repeat."
  }
}

export interface AutorunSchedulePanelProps {
  readonly startTime: string
  readonly endTime: string
  /** Already-formatted countdown, or `null` when it is no longer a countdown. */
  readonly countdown: string | null
  readonly retirement: ScheduleRetirement
}

export function AutorunSchedulePanel({
  startTime,
  endTime,
  countdown,
  retirement,
}: AutorunSchedulePanelProps) {
  const duration = elapsedSeconds(startTime, endTime)
  return (
    <Panel>
      <PanelHead
        title="Schedule"
        actions={
          countdown === null ? undefined : (
            <span data-slot="countdown" className="mono text-base text-ink">
              {countdown}
            </span>
          )
        }
      />
      <PanelBody>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 max-sm:grid-cols-1">
          <FactRow label="Starts">
            {/* The zone is named once, on the pair's first line — never repeated. */}
            <TimeText value={startTime} withZone />
          </FactRow>
          <FactRow label="Ends">
            <TimeText value={endTime} />
          </FactRow>
          <FactRow label="Duration">
            <span className="mono">{duration === null ? "—" : formatDuration(duration)}</span>
          </FactRow>
        </dl>
        <p className="mt-4 border-t border-line-subtle pt-3 text-sm text-ink-muted">
          {retirementCopy(retirement)}
        </p>
      </PanelBody>
    </Panel>
  )
}
