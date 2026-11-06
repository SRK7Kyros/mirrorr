import { describe, expect, it } from "vitest"
import type { Notification } from "@/api/schemas"
import { describeNotification } from "./notification-copy"

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    resource_type: "session",
    resource_id: 913,
    event_type: "session.stopped",
    title: "Session stopped",
    created_at: "2026-11-06T12:00:00Z",
    ...overrides,
  }
}

describe("describeNotification", () => {
  it("reads a dotted event name as a sentence, not as a token", () => {
    expect(describeNotification(notification())).toEqual({
      headline: "Session #913 stopped",
      target: { kind: "session", id: 913, label: "Open session #913" },
    })
  })

  it("says a new recording is ready rather than 'created'", () => {
    const copy = describeNotification(
      notification({ resource_type: "recording", resource_id: 4, event_type: "recording.created" }),
    )
    expect(copy.headline).toBe("Recording #4 is ready")
    expect(copy.target).toEqual({ kind: "recording", id: 4, label: "Open recording #4" })
  })

  it("links an autorun row to the autorun", () => {
    const copy = describeNotification(
      notification({ resource_type: "autorun", resource_id: 2, event_type: "autorun.updated" }),
    )
    expect(copy.headline).toBe("Autorun #2 updated")
    expect(copy.target).toEqual({ kind: "autorun", id: 2, label: "Open autorun #2" })
  })

  it("falls back to the server's own title for an event this build does not know", () => {
    const copy = describeNotification(
      notification({
        resource_type: "session",
        event_type: "session.quarantined",
        title: "The run was quarantined",
      }),
    )
    expect(copy.headline).toBe("The run was quarantined")
    expect(copy.target).toEqual({ kind: "session", id: 913, label: "Open session #913" })
  })

  it("names the subject when an unknown event carries no title", () => {
    const copy = describeNotification(
      notification({ resource_type: "session", event_type: "session.quarantined", title: "  " }),
    )
    expect(copy.headline).toBe("Session #913")
  })

  it("offers no link for a resource the console has no route for", () => {
    const copy = describeNotification(
      notification({ resource_type: "plugin", resource_id: 8, event_type: "plugin.updated" }),
    )
    expect(copy.headline).toBe("Plugin #8 updated")
    expect(copy.target).toBeNull()
  })
})
