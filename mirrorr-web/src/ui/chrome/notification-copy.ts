import type { Notification } from "@/api/schemas"
import { humanize } from "@/ui/lib/format"

/**
 * One reading of a notification row for a human (`CMP-18`).
 *
 * The drawer used to print whatever the row carried — `session 913:
 * session.stopped`, an event name with a dotted id in it — which names the
 * transport rather than the event. The verb is read from `event_type`, the noun
 * from `resource_type`, and the link points at the object itself so the row is
 * actionable instead of a dead sentence. An event this build does not know falls
 * back to the server's own `title` rather than to the raw token.
 */
export type NotificationTarget =
  | { readonly kind: "session"; readonly id: number; readonly label: string }
  | { readonly kind: "autorun"; readonly id: number; readonly label: string }
  | { readonly kind: "recording"; readonly id: number; readonly label: string }

export interface NotificationCopy {
  readonly headline: string
  readonly target: NotificationTarget | null
}

const SUBJECTS: Record<string, string> = {
  session: "Session",
  autorun: "Autorun",
  recording: "Recording",
  profile: "Profile",
  source: "Source",
  plugin: "Plugin",
  user: "User",
}

const VERBS: Record<string, string> = {
  started: "started",
  stopped: "stopped",
  crashed: "crashed",
  completed: "completed",
  failed: "failed",
  created: "created",
  updated: "updated",
  deleted: "was deleted",
  finished: "finished",
  retrying: "is retrying",
}

function suffixOf(eventType: string): string {
  const dot = eventType.lastIndexOf(".")
  return dot === -1 ? eventType : eventType.slice(dot + 1)
}

function targetOf(item: Notification): NotificationTarget | null {
  switch (item.resource_type) {
    case "session":
      return { kind: "session", id: item.resource_id, label: `Open session #${item.resource_id}` }
    case "autorun":
      return { kind: "autorun", id: item.resource_id, label: `Open autorun #${item.resource_id}` }
    case "recording":
      return {
        kind: "recording",
        id: item.resource_id,
        label: `Open recording #${item.resource_id}`,
      }
    default:
      return null
  }
}

export function describeNotification(item: Notification): NotificationCopy {
  const subject = SUBJECTS[item.resource_type] ?? humanize(item.resource_type)
  const suffix = suffixOf(item.event_type)
  const verb =
    suffix === "created" && item.resource_type === "recording" ? "is ready" : VERBS[suffix]
  const title = item.title.trim()

  const headline =
    verb === undefined
      ? title !== ""
        ? title
        : `${subject} #${item.resource_id}`
      : `${subject} #${item.resource_id} ${verb}`

  return { headline, target: targetOf(item) }
}
