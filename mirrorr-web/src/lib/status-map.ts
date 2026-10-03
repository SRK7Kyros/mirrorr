/**
 * STATUS_MAP — the single source of truth for status → label / tone / dot /
 * row actions, bound by `docs/console-design-spec.md` §1.4 (the executable UI
 * spec). No view may invent statuses; unrecognized strings render as `unknown`
 * (with a warning); this map wins over per-view action lists.
 *
 * Tones are token names, never CSS-variable strings — `styles/tokens.css` owns
 * the hex values (spec §1.4 gives each status its tier, indicator hue and the
 * icon + word doubling rule; status colour never carries text).
 */

export type StatusTone = "primary" | "secondary" | "success" | "warning" | "danger" | "neutral"

export type StatusDot = "static" | "pulse" | "spinner"

export type RowAction =
  | "stop"
  | "enable-recording"
  | "disable-recording"
  | "delete"
  | "save-as-profile"
  | "edit"
  | "run-now"

export interface StatusDescriptor {
  readonly label: string
  readonly tone: StatusTone
  readonly dot: StatusDot
  /** Chip suffix icon for completed (✓) / failed (✕). */
  readonly icon?: "check" | "cross"
  /** Row actions (sessions) — `delete` absent ⇒ never rendered, not disabled. */
  readonly sessionActions: readonly RowAction[]
  /** Row actions (autoruns). */
  readonly autorunActions: readonly RowAction[]
}

const NO_ACTIONS: readonly RowAction[] = []
const DELETE_ONLY: readonly RowAction[] = ["delete"]
const SAVE_DELETE: readonly RowAction[] = ["save-as-profile", "delete"]

export const STATUS_MAP = {
  scheduled: {
    label: "Scheduled",
    tone: "primary",
    dot: "static",
    sessionActions: NO_ACTIONS,
    autorunActions: ["edit", "delete", "run-now"],
  },
  active: {
    label: "Running",
    tone: "success",
    dot: "static",
    sessionActions: ["stop", "enable-recording", "delete"],
    autorunActions: ["edit", "delete"],
  },
  recording: {
    label: "Recording",
    tone: "danger",
    dot: "pulse",
    sessionActions: ["stop", "disable-recording", "delete"],
    autorunActions: ["edit", "delete"],
  },
  terminating: {
    label: "Stopping…",
    tone: "warning",
    dot: "spinner",
    sessionActions: DELETE_ONLY,
    autorunActions: DELETE_ONLY,
  },
  remuxing: {
    label: "Remuxing",
    tone: "secondary",
    dot: "spinner",
    sessionActions: NO_ACTIONS,
    autorunActions: NO_ACTIONS,
  },
  finalizing: {
    label: "Finalizing",
    tone: "secondary",
    dot: "spinner",
    sessionActions: NO_ACTIONS,
    autorunActions: NO_ACTIONS,
  },
  completed: {
    label: "Completed",
    tone: "success",
    dot: "static",
    icon: "check",
    sessionActions: SAVE_DELETE,
    autorunActions: SAVE_DELETE,
  },
  failed: {
    label: "Failed",
    tone: "danger",
    dot: "static",
    icon: "cross",
    sessionActions: SAVE_DELETE,
    autorunActions: SAVE_DELETE,
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    dot: "static",
    sessionActions: DELETE_ONLY,
    autorunActions: DELETE_ONLY,
  },
} as const satisfies Record<string, StatusDescriptor>

export type StatusKey = keyof typeof STATUS_MAP

const KNOWN_KEYS = new Set<string>(Object.keys(STATUS_MAP))

/** Resolve any server status string; unknown values log a warning → `unknown`. */
export function getStatusDescriptor(status: string): StatusDescriptor {
  if (KNOWN_KEYS.has(status)) return STATUS_MAP[status as StatusKey]
  console.warn(`Unrecognized status "${status}" — rendering as unknown`)
  return STATUS_MAP.unknown
}
