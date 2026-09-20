import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PREFS_STORAGE_KEY,
  handleNotificationFrame,
  isToastEnabled,
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationFrame,
} from "@/lib/notification-policy"
import { clearToasts, getToasts } from "@/lib/toast"

function frame(eventType: string, title = "Something happened"): NotificationFrame {
  return {
    resource_type: eventType.split(".")[0] ?? "session",
    resource_id: 7,
    event_type: eventType,
    title,
    created_at: "2026-09-20T00:00:00Z",
  }
}

beforeEach(() => {
  window.localStorage.clear()
  clearToasts()
})

afterEach(() => {
  clearToasts()
})

describe("notification preferences", () => {
  it("defaults to every category enabled when storage is empty", () => {
    expect(readNotificationPrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it("round-trips preferences through localStorage", () => {
    writeNotificationPrefs({ crashes: false, completions: true, recordings: false })

    const raw = window.localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? "{}")).toEqual({
      crashes: false,
      completions: true,
      recordings: false,
    })
    expect(readNotificationPrefs()).toEqual({ crashes: false, completions: true, recordings: false })
  })

  it("falls back to defaults for malformed storage", () => {
    window.localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, "{not json")
    expect(readNotificationPrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS)

    window.localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify({ crashes: "no" }))
    expect(readNotificationPrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
})

describe("toast policy", () => {
  const allOn = { crashes: true, completions: true, recordings: true }

  it("maps the four spec toast events onto the three categories", () => {
    expect(isToastEnabled(frame("session.crashed"), allOn)).toBe(true)
    expect(isToastEnabled(frame("session.failed"), allOn)).toBe(true)
    expect(isToastEnabled(frame("session.stopped"), allOn)).toBe(true)
    expect(isToastEnabled(frame("recording.created"), allOn)).toBe(true)
  })

  it("ignores events outside the spec toast set", () => {
    expect(isToastEnabled(frame("profile.updated"), allOn)).toBe(false)
    expect(isToastEnabled(frame("session.started"), allOn)).toBe(false)
  })

  it("gates each event on its category", () => {
    const crashesOff = { crashes: false, completions: true, recordings: true }
    expect(isToastEnabled(frame("session.crashed"), crashesOff)).toBe(false)
    expect(isToastEnabled(frame("session.failed"), crashesOff)).toBe(false)
    expect(isToastEnabled(frame("session.stopped"), crashesOff)).toBe(true)

    const completionsOff = { crashes: true, completions: false, recordings: true }
    expect(isToastEnabled(frame("session.stopped"), completionsOff)).toBe(false)

    const recordingsOff = { crashes: true, completions: true, recordings: false }
    expect(isToastEnabled(frame("recording.created"), recordingsOff)).toBe(false)
  })
})

describe("handleNotificationFrame", () => {
  it("toasts an enabled frame with its title and returns true", () => {
    const toasted = handleNotificationFrame(frame("session.crashed", "Session 7 crashed"))

    expect(toasted).toBe(true)
    expect(getToasts().map((toast) => toast.message)).toEqual(["Session 7 crashed"])
  })

  it("does not toast a disabled frame", () => {
    writeNotificationPrefs({ crashes: false, completions: true, recordings: true })

    const toasted = handleNotificationFrame(frame("session.crashed", "Session 7 crashed"))

    expect(toasted).toBe(false)
    expect(getToasts()).toHaveLength(0)
  })

  it("does not toast events outside the spec set", () => {
    expect(handleNotificationFrame(frame("session.updated", "Updated"))).toBe(false)
    expect(getToasts()).toHaveLength(0)
  })

  it("marks crashes and failures as error tones and completions as info", () => {
    handleNotificationFrame(frame("session.failed", "Failed"))
    handleNotificationFrame(frame("session.stopped", "Stopped"))

    expect(getToasts().map((toast) => toast.tone)).toEqual(["error", "info"])
  })
})
