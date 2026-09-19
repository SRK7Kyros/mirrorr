/**
 * Status & Lifecycle Map — the single exported source of status labels, colour
 * tokens, dots and status-dependent action sets.
 *
 * Contract: `docs/web-frontend-spec.md` L193-L213 (the map itself) and
 * L404 (StatusChip consumes it). No view may invent a status or restate these
 * semantics: this map is the authority and, where a per-view action list
 * disagrees, this map wins. An unrecognized status string renders as the
 * `unknown` entry (neutral chip, raw string in the tooltip) and logs a warning.
 */

/** Session lifecycle statuses (7) — a session is never `scheduled`. */
export const SESSION_STATUSES = [
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
  "completed",
  "failed",
] as const

/** Autorun lifecycle statuses (8) — adds the pre-start `scheduled` state. */
export const AUTORUN_STATUSES = ["scheduled", ...SESSION_STATUSES] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]
export type AutorunStatus = (typeof AUTORUN_STATUSES)[number]
export type StatusKey = AutorunStatus | "unknown"

/** Colour tokens named by the spec map; the chip resolves them to utilities. */
export type StatusColorToken = "--ok" | "--danger" | "--warn" | "--info" | "--purple" | "--neutral"

/** Dot treatment: static dot, 1.6s pulse, spinner, or the ✓/✕ state icons. */
export type StatusDot = "static" | "pulse" | "spinner" | "check" | "cross"

export type StatusActionId =
  | "stop"
  | "toggle-recording"
  | "save-as-profile"
  | "delete"
  | "edit"
  | "run-now"

export interface StatusAction {
  readonly id: StatusActionId
  readonly label: string
  readonly kind: "default" | "danger"
  /** Rendered inside the row overflow menu rather than inline. */
  readonly overflow: boolean
  /** Autorun edit with config fields locked while live (spec L295/L307). */
  readonly lockedFields: boolean
  /** Present but disabled (e.g. Stop while `terminating`). */
  readonly disabled: boolean
}

export interface StatusEntry {
  readonly label: string
  readonly colorToken: StatusColorToken
  readonly dot: StatusDot
  readonly sessionActions: readonly StatusAction[]
  readonly autorunActions: readonly StatusAction[]
}

type StatusActionOverrides = Partial<Pick<StatusAction, "kind" | "overflow" | "lockedFields" | "disabled">>

function action(id: StatusActionId, label: string, overrides: StatusActionOverrides = {}): StatusAction {
  return { id, label, kind: "default", overflow: false, lockedFields: false, disabled: false, ...overrides }
}

const DELETE_OVERFLOW = action("delete", "Delete", { kind: "danger", overflow: true })
const DELETE_ROW = action("delete", "Delete", { kind: "danger" })
const SAVE_AS_PROFILE = action("save-as-profile", "Save as profile")

/**
 * Session statuses never include `scheduled`; autorun statuses do. Entries are
 * in lifecycle order (spec L199-L211).
 */
export const STATUS_MAP: Record<StatusKey, StatusEntry> = {
  scheduled: {
    label: "Scheduled",
    colorToken: "--info",
    dot: "static",
    sessionActions: [],
    autorunActions: [action("edit", "Edit"), DELETE_ROW, action("run-now", "Run now")],
  },
  active: {
    label: "Running",
    colorToken: "--ok",
    dot: "static",
    sessionActions: [
      action("stop", "Stop"),
      action("toggle-recording", "Enable recording"),
      DELETE_OVERFLOW,
    ],
    autorunActions: [action("edit", "Edit", { lockedFields: true }), DELETE_ROW],
  },
  recording: {
    label: "Recording",
    colorToken: "--danger",
    dot: "pulse",
    sessionActions: [
      action("stop", "Stop"),
      action("toggle-recording", "Disable recording"),
      DELETE_OVERFLOW,
    ],
    autorunActions: [action("edit", "Edit", { lockedFields: true }), DELETE_ROW],
  },
  terminating: {
    label: "Stopping…",
    colorToken: "--warn",
    dot: "static",
    sessionActions: [action("stop", "Stop", { disabled: true }), DELETE_OVERFLOW],
    autorunActions: [DELETE_OVERFLOW],
  },
  remuxing: {
    label: "Remuxing",
    colorToken: "--purple",
    dot: "spinner",
    // Delete is hidden on remuxing/finalizing (spec L203-L205).
    sessionActions: [],
    autorunActions: [],
  },
  finalizing: {
    label: "Finalizing",
    colorToken: "--purple",
    dot: "spinner",
    // Delete is hidden on remuxing/finalizing (spec L203-L205).
    sessionActions: [],
    autorunActions: [],
  },
  completed: {
    label: "Completed",
    colorToken: "--ok",
    dot: "check",
    sessionActions: [SAVE_AS_PROFILE, DELETE_ROW],
    autorunActions: [SAVE_AS_PROFILE, DELETE_ROW],
  },
  failed: {
    label: "Failed",
    colorToken: "--danger",
    dot: "cross",
    sessionActions: [SAVE_AS_PROFILE, DELETE_ROW],
    autorunActions: [SAVE_AS_PROFILE, DELETE_ROW],
  },
  unknown: {
    label: "Unknown",
    colorToken: "--neutral",
    dot: "static",
    sessionActions: [DELETE_ROW],
    autorunActions: [DELETE_ROW],
  },
}

/** Every status key in lifecycle order, including the `unknown` fallback. */
export const STATUS_KEYS: readonly StatusKey[] = Object.keys(STATUS_MAP) as StatusKey[]

export interface ResolvedStatus {
  readonly key: StatusKey
  readonly raw: string
  readonly isUnknown: boolean
  readonly entry: StatusEntry
}

/** Deduped per unrecognized string so a re-rendering row cannot spam. */
const warnedUnknownStatuses = new Set<string>()

/**
 * Resolves a raw status string from the API to a map entry. Unknown strings
 * warn once and resolve to the `unknown` entry, with the raw string preserved
 * for the chip tooltip (spec L200).
 */
export function resolveStatus(raw: string): ResolvedStatus {
  const entry = (STATUS_MAP as Record<string, StatusEntry | undefined>)[raw]
  if (entry !== undefined) {
    return { key: raw as StatusKey, raw, isUnknown: false, entry }
  }

  if (!warnedUnknownStatuses.has(raw)) {
    warnedUnknownStatuses.add(raw)
    console.warn(`[status-map] unrecognized status "${raw}" rendered as "unknown"`)
  }

  return { key: "unknown", raw, isUnknown: true, entry: STATUS_MAP.unknown }
}

export interface SessionActionOptions {
  /**
   * Engine `can_record`. When false the recording toggle stays visible but
   * disabled (spec L400: never hidden).
   */
  readonly canRecord?: boolean
}

/** Session actions for a raw status. The only source of status-dependent actions. */
export function sessionActionsFor(
  status: string,
  options: SessionActionOptions = {},
): readonly StatusAction[] {
  const { entry } = resolveStatus(status)
  if (options.canRecord === false) {
    return entry.sessionActions.map((action) =>
      action.id === "toggle-recording" ? { ...action, disabled: true } : action,
    )
  }
  return entry.sessionActions
}

/** Autorun actions for a raw status. The only source of status-dependent actions. */
export function autorunActionsFor(status: string): readonly StatusAction[] {
  return resolveStatus(status).entry.autorunActions
}
