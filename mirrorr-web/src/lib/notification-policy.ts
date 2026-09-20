/**
 * Local notification preferences and the toast policy for pushed frames.
 *
 * Contract: `docs/web-frontend-spec.md` L195 — "toast only for `session.crashed`,
 * `session.stopped`, `recording.created`, `*.failed` (user-configurable in
 * Settings)", L371 — the three V11 categories live in localStorage.
 */
import { z } from "zod"
import { showToast } from "@/lib/toast"

export const NOTIFICATION_PREFS_STORAGE_KEY = "mirrorr.notification-prefs"

/** Dev/e2e seam: the real socket transport is a later wave (spec todo 18/20), so frames enter here. */
export const NOTIFICATION_FRAME_EVENT = "mirrorr:notification-frame"

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

/** Returns whether a toast was raised (the raw frame is ignored when its category is off). */
export function handleNotificationFrame(frame: NotificationFrame): boolean {
  if (!isToastEnabled(frame, readNotificationPrefs())) return false

  showToast(frame.title, toastTone(frame))
  return true
}

function isNotificationFrame(value: unknown): value is NotificationFrame {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { event_type?: unknown; title?: unknown }
  return typeof candidate.event_type === "string" && typeof candidate.title === "string"
}

export function installNotificationFrameBridge(target: Window = window): () => void {
  const listener = (event: Event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    if (isNotificationFrame(detail)) handleNotificationFrame(detail)
  }

  target.addEventListener(NOTIFICATION_FRAME_EVENT, listener)
  return () => target.removeEventListener(NOTIFICATION_FRAME_EVENT, listener)
}
