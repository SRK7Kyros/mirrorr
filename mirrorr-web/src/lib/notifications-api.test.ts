/**
 * Notification REST endpoints (contract §11.3, §13.8/§13.10.2):
 * `GET /notifications/` → 200 `NotificationResponse[]` (array, no cursor);
 * `POST /notifications/{id}/read` → updated row; `POST /notifications/read-all`;
 * `DELETE /notifications/{id}`. The drawer's footer "Clear" loops one delete
 * per loaded REST row behind a single confirmation (spec L406).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import {
  clearNotifications,
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications-api"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const ROW = {
  id: 11,
  user_id: 1,
  resource_type: "recording",
  resource_id: 5,
  event_type: "recording.created",
  title: "recording 5 created",
  body: "",
  read: false,
  created_at: "2026-09-19T10:00:00",
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("notifications API", () => {
  it("lists rows from GET /notifications/ and tolerates an omitted body", async () => {
    const { body: _body, ...withoutBody } = ROW
    const fetchMock = installFetch(async () => jsonResponse(200, [withoutBody]))

    const rows = await fetchNotifications()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(11)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/notifications/")
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET")
  })

  it("marks one row read with POST /notifications/{id}/read", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { ...ROW, read: true }))

    await markNotificationRead(11)

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/notifications/11/read")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
  })

  it("marks all rows read with POST /notifications/read-all", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { status: "all_marked_read" }))

    await markAllNotificationsRead()

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/notifications/read-all")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST")
  })

  it("deletes one row with DELETE /notifications/{id}", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, { status: "deleted" }))

    await deleteNotification(11)

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/notifications/11")
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE")
  })

  it("Clear loops one deletion per loaded REST row, in order, and survives one failure", async () => {
    const calls: number[] = []
    const rows = [
      { ...ROW, id: 21 },
      { ...ROW, id: 22 },
      { ...ROW, id: 23 },
    ]

    const result = await clearNotifications(rows, async (id) => {
      calls.push(id)
      if (id === 22) throw new Error("boom")
    })

    expect(calls).toEqual([21, 22, 23])
    expect(result).toEqual({ deleted: 2, failed: 1 })
  })
})
