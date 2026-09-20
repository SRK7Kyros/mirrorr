/**
 * Local notification preferences, the toast policy for pushed frames, and the
 * in-memory half of the bell badge.
 *
 * Contract: `docs/web-frontend-spec.md` L195 — "toast only for `session.crashed`,
 * `session.stopped`, `recording.created`, `*.failed` (user-configurable in
 * Settings)", L371 — the three V11 categories live in localStorage; L187 —
 * the badge is ONE number built from TWO components: REST unread rows plus
 * synthetic WS frames not yet acknowledged (tuple dedupe, never an `id` join),
 * with `read-all` zeroing both and the drawer clearing neither.
 * `docs/general-client-specification.md` §11.2, §13.10.2 — synthetic frames
 * carry `(resource_type, resource_id, event_type, title, created_at)` and no
 * `id`/`body`/`read`.
 *
 * `notification-pipeline.ts` calls `handleNotificationFrame` for every frame
 * the `/ws/notifications` socket pushes; the badge arithmetic stays
 * socket-independent.
 */
import { z } from "zod"
import { showToast } from "@/lib/toast"

export const NOTIFICATION_PREFS_STORAGE_KEY = "mirrorr.notification-prefs"

export interface NotificationPrefs {
  readonly crashes: boolean
  readonly completions: boolean
  readonly recordings: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  crashes: true,
  completions: true,
  recordings: true,
}

export interface NotificationFrame {
  readonly event_type: string
  readonly title: string
  readonly resource_type?: string
  readonly resource_id?: number
  readonly created_at?: string
}

/** A normalized synthetic frame held only in memory for the badge (no REST join). */
export interface SyntheticNotification {
  readonly event_type: string
  readonly title: string
  readonly resource_type: string | null
  readonly resource_id: number | null
  readonly created_at: string | null
}

/** The tuple identity shared by synthetic frames and REST rows (never `id`). */
export interface NotificationIdentity {
  readonly resource_type: string
  readonly resource_id: number
  readonly event_type: string
}

/**
 * Stable dedupe key. Complete frames use the spec's tuple; frame shapes that
 * omit the resource use the remaining frame fields so a replay of the exact
 * same frame still dedupes.
 */
export function notificationTuple(frame: SyntheticNotification): string {
  if (frame.resource_type !== null && frame.resource_id !== null) {
    return `${frame.resource_type}:${frame.resource_id}:${frame.event_type}`
  }
  return `${frame.event_type}|${frame.title}|${frame.created_at ?? ""}`
}

export function normalizeSyntheticFrame(frame: NotificationFrame): SyntheticNotification {
  return {
    event_type: frame.event_type,
    title: frame.title,
    resource_type: typeof frame.resource_type === "string" ? frame.resource_type : null,
    resource_id: typeof frame.resource_id === "number" ? frame.resource_id : null,
    created_at: typeof frame.created_at === "string" ? frame.created_at : null,
  }
}

let syntheticFrames: readonly SyntheticNotification[] = []
const syntheticListeners = new Set<() => void>()

function setSyntheticFrames(next: readonly SyntheticNotification[]): void {
  syntheticFrames = next
  for (const listener of syntheticListeners) listener()
}

/** Component (b) of the badge: every unacknowledged synthetic frame, in arrival order. */
export function getSyntheticNotifications(): readonly SyntheticNotification[] {
  return syntheticFrames
}

export function subscribeToSyntheticNotifications(listener: () => void): () => void {
  syntheticListeners.add(listener)
  return () => syntheticListeners.delete(listener)
}

/** Records a pushed frame; returns `false` when its tuple is already counted. */
export function addSyntheticNotification(frame: NotificationFrame): boolean {
  const normalized = normalizeSyntheticFrame(frame)
  const key = notificationTuple(normalized)
  if (syntheticFrames.some((existing) => notificationTuple(existing) === key)) return false

  setSyntheticFrames([...syntheticFrames, normalized])
  return true
}

/** `read-all` zeroes component (b) (spec L187); opening the drawer never does. */
export function acknowledgeAllSyntheticNotifications(): void {
  if (syntheticFrames.length === 0) return
  setSyntheticFrames([])
}

/** Logout/test teardown: the badge must not survive the session. */
export function resetSyntheticNotifications(): void {
  if (syntheticFrames.length === 0) return
  setSyntheticFrames([])
}

/**
 * Counts synthetic frames whose tuple has no matching REST row. Matching is on
 * `(resource_type, resource_id, event_type)` only — never on `id`, and never
 * on `read` (contract §13.10.2).
 */
export function countPendingSyntheticNotifications(
  frames: readonly SyntheticNotification[],
  restRows: readonly NotificationIdentity[],
): number {
  const restTuples = new Set(restRows.map((row) => `${row.resource_type}:${row.resource_id}:${row.event_type}`))
  return frames.filter((frame) => {
    if (frame.resource_type !== null && frame.resource_id !== null) {
      return !restTuples.has(`${frame.resource_type}:${frame.resource_id}:${frame.event_type}`)
    }
    return true
  }).length
}

/** The single badge number: component (a) + component (b), floored at zero. */
export function notificationBadgeCount(components: {
  readonly restUnread: number
  readonly syntheticPending: number
}): number {
  return Math.max(0, components.restUnread + components.syntheticPending)
}

type NotificationCategory = keyof NotificationPrefs

type PrefsStorage = Pick<Storage, "getItem" | "setItem">

const prefsSchema = z.object({
  crashes: z.boolean(),
  completions: z.boolean(),
  recordings: z.boolean(),
})

export function readNotificationPrefs(storage: PrefsStorage = window.localStorage): NotificationPrefs {
  const raw = storage.getItem(NOTIFICATION_PREFS_STORAGE_KEY)
  if (raw === null) return DEFAULT_NOTIFICATION_PREFS

  try {
    const parsed = prefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS
  } catch {
    return DEFAULT_NOTIFICATION_PREFS
  }
}

export function writeNotificationPrefs(
  prefs: NotificationPrefs,
  storage: PrefsStorage = window.localStorage,
): void {
  try {
    storage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    return
  }
}

export function notificationCategory(eventType: string): NotificationCategory | null {
  if (eventType === "session.crashed" || eventType.endsWith(".failed")) return "crashes"
  if (eventType === "session.stopped") return "completions"
  if (eventType === "recording.created") return "recordings"
  return null
}

export function isToastEnabled(frame: NotificationFrame, prefs: NotificationPrefs): boolean {
  const category = notificationCategory(frame.event_type)
  return category !== null && prefs[category]
}

function toastTone(frame: NotificationFrame): "error" | "info" {
  return notificationCategory(frame.event_type) === "crashes" ? "error" : "info"
}

/**
 * The one entry point for a pushed frame: always counts it toward the badge,
 * and raises a toast only when its category is enabled.
 */
export function handleNotificationFrame(frame: NotificationFrame): boolean {
  addSyntheticNotification(frame)

  if (!isToastEnabled(frame, readNotificationPrefs())) return false

  showToast(frame.title, toastTone(frame))
  return true
}
