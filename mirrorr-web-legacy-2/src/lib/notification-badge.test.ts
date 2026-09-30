/**
 * Spec L130/L187 (client contract §11.2-§11.3, §13.10.2): the bell badge is ONE
 * number built from TWO components — (a) REST unread rows, (b) synthetic WS
 * frames received since connect and not yet acknowledged. A synthetic frame
 * increments (b) once per `(resource_type, resource_id, event_type)` tuple; a
 * REST row matching a synthetic tuple removes that frame from (b); `read-all`
 * zeroes both; opening the drawer clears neither.
 *
 * The arithmetic is in-memory and socket-independent — todo 18's socket feeds
 * `handleNotificationFrame` and this store must already be correct.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  NOTIFICATION_PREFS_STORAGE_KEY,
  acknowledgeAllSyntheticNotifications,
  addSyntheticNotification,
  countPendingSyntheticNotifications,
  getSyntheticNotifications,
  handleNotificationFrame,
  notificationBadgeCount,
  resetSyntheticNotifications,
  subscribeToSyntheticNotifications,
  type NotificationFrame,
} from "@/lib/notification-policy"

const FRAME: NotificationFrame = {
  resource_type: "session",
  resource_id: 5,
  event_type: "session.crashed",
  title: "session 5: session.crashed",
  created_at: "2026-09-19T10:00:00",
}

function restRow(overrides: Partial<{ resource_type: string; resource_id: number; event_type: string; read: boolean }> = {}) {
  return {
    resource_type: "session",
    resource_id: 5,
    event_type: "session.crashed",
    read: false,
    ...overrides,
  }
}

afterEach(() => {
  resetSyntheticNotifications()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("badge arithmetic", () => {
  it("counts REST unread rows and pending synthetic frames as one number", () => {
    expect(notificationBadgeCount({ restUnread: 2, syntheticPending: 1 })).toBe(3)
    expect(notificationBadgeCount({ restUnread: 0, syntheticPending: 0 })).toBe(0)
  })

  it("increments once per tuple when the same synthetic frame arrives twice", () => {
    expect(addSyntheticNotification(FRAME)).toBe(true)
    expect(addSyntheticNotification(FRAME)).toBe(false)
    expect(getSyntheticNotifications()).toHaveLength(1)

    const other = { ...FRAME, resource_id: 6 }
    expect(addSyntheticNotification(other)).toBe(true)
    expect(getSyntheticNotifications()).toHaveLength(2)
  })

  it("subtracts a synthetic frame once a REST row matches its tuple (no id join)", () => {
    addSyntheticNotification(FRAME)
    addSyntheticNotification({ ...FRAME, resource_id: 6 })

    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [restRow()])).toBe(1)
    // read rows still dedupe: tuple identity, never `read` (contract §13.10.2).
    expect(
      countPendingSyntheticNotifications(getSyntheticNotifications(), [restRow({ read: true })]),
    ).toBe(1)
    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [restRow(), restRow({ resource_id: 6 })])).toBe(0)
  })

  it("read-all acknowledges every synthetic frame (zeroes component b)", () => {
    addSyntheticNotification(FRAME)
    addSyntheticNotification({ ...FRAME, resource_id: 6 })

    acknowledgeAllSyntheticNotifications()

    expect(getSyntheticNotifications()).toEqual([])
    expect(countPendingSyntheticNotifications(getSyntheticNotifications(), [])).toBe(0)
  })

  it("opening the drawer clears nothing: the synthetic store only changes on add/read-all/reset", () => {
    addSyntheticNotification(FRAME)
    // Reading the store must not acknowledge.
    expect(getSyntheticNotifications()).toHaveLength(1)
    expect(getSyntheticNotifications()).toHaveLength(1)
  })

  it("records the frame for the badge even when its toast category is disabled", () => {
    window.localStorage.setItem(
      NOTIFICATION_PREFS_STORAGE_KEY,
      JSON.stringify({ crashes: false, completions: false, recordings: false }),
    )

    expect(handleNotificationFrame(FRAME)).toBe(false)
    expect(getSyntheticNotifications()).toHaveLength(1)
  })

  it("notifies subscribers on add and acknowledge", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSyntheticNotifications(listener)

    addSyntheticNotification(FRAME)
    expect(listener).toHaveBeenCalledTimes(1)

    acknowledgeAllSyntheticNotifications()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    addSyntheticNotification({ ...FRAME, resource_id: 9 })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
