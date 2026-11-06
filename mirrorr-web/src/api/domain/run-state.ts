/**
 * `deriveRunState` — the one reducer that turns a server status into the
 * vocabulary every surface uses: chip label + tone, the hero metric, whether
 * the run needs attention, and which panels a detail page may show.
 *
 * The console used to answer these questions independently in the card, the
 * pill, the header and each panel, which is how a live run ended up showing
 * "Waiting for the supervisor" under a `Completed` chip. Conditions belong
 * here; views only render the answer.
 */

import { getStatusDescriptor, isStarting, type StatusDot, type StatusTone } from "@/api/status"

export type RunState =
  | "scheduled"
  | "starting"
  | "live"
  | "recording"
  | "finalising"
  | "completed"
  | "failed"
  | "retired"
  | "unknown"

/** Which number earns the card's hero slot. */
export type RunHero = "countdown" | "elapsed" | "duration" | "reason" | "none"

/** The single current verb for a detail header — never a state used as a label. */
export type RunVerb = "stop" | "open-recording" | "retry" | "edit-schedule" | "run-now" | null

export interface RunStateInput {
  readonly status: string
  /** The run is capturing to a file (`session.recording`). */
  readonly recording?: boolean
  /** A file already exists for this run — completed or still finalising. */
  readonly hasRecording?: boolean
  /**
   * The schedule's window has passed. The scheduler keeps the row for history,
   * but nothing will start it again — that is a terminal state, not `Scheduled`.
   */
  readonly retired?: boolean
  /** A blocking problem the record itself states (e.g. deleted profile). */
  readonly issue?: string | null
}

export interface RunPanels {
  /** Live resolver/source inspection only makes sense while the run is up. */
  readonly sources: boolean
  /** The recording panel exists only when a file exists. */
  readonly recording: boolean
  /** Terminal runs never show live telemetry. */
  readonly live: boolean
}

export interface RunStateView {
  readonly state: RunState
  readonly label: string
  readonly tone: StatusTone
  readonly dot: StatusDot
  readonly hero: RunHero
  readonly attention: boolean
  readonly verb: RunVerb
  readonly panels: RunPanels
}

const TERMINAL = new Set<RunState>(["completed", "failed", "retired"])

export function deriveRunState(input: RunStateInput): RunStateView {
  const descriptor = getStatusDescriptor(input.status)
  const retired = input.retired === true && input.status === "scheduled"
  const starting = isStarting(input.status)
  const hasRecording =
    input.hasRecording !== undefined
      ? input.hasRecording
      : input.status === "recording" ||
        input.status === "remuxing" ||
        input.status === "finalizing" ||
        input.status === "completed" ||
        input.status === "failed"

  const state: RunState = retired
    ? "retired"
    : starting
      ? "starting"
      : input.status === "recording"
        ? "recording"
        : input.status === "active" || input.status === "terminating"
          ? "live"
          : input.status === "remuxing" || input.status === "finalizing"
            ? "finalising"
            : input.status === "completed"
              ? "completed"
              : input.status === "failed"
                ? "failed"
                : input.status === "scheduled"
                  ? "scheduled"
                  : "unknown"

  const hero: RunHero = retired
    ? "duration"
    : state === "scheduled"
      ? "countdown"
      : state === "starting" || state === "live" || state === "recording"
        ? "elapsed"
        : state === "finalising" || state === "completed"
          ? "duration"
          : state === "failed"
            ? "reason"
            : "none"

  const live = state === "starting" || state === "live" || state === "recording"

  return {
    state,
    label: retired ? "Retired" : descriptor.label,
    tone: retired ? "neutral" : descriptor.tone,
    dot: descriptor.dot,
    hero,
    attention: input.issue !== undefined && input.issue !== null
      ? input.issue !== ""
      : state === "failed",
    verb:
      state === "starting" || state === "live" || state === "recording"
        ? "stop"
        : state === "completed" || state === "failed"
          ? hasRecording
            ? "open-recording"
            : "retry"
          : state === "scheduled"
            ? "edit-schedule"
            : null,
    panels: {
      sources: live,
      recording: hasRecording || state === "finalising" || TERMINAL.has(state),
      live,
    },
  }
}
