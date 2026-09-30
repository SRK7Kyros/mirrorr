/**
 * Notification endpoints.
 *
 * Contract: `docs/general-client-specification.md` §11.3 and §13.8 —
 * `GET /notifications/` answers a plain `NotificationResponse[]` (own only,
 * 401 for an API-client principal), `POST /notifications/{id}/read` answers the
 * updated row, `POST /notifications/read-all` answers `{status}`, and
 * `DELETE /notifications/{id}` answers `{status}`. Row shape and the
 * synthetic-frame distinction: §13.10.2. Drawer behavior incl. the footer
 * "Clear": `docs/web-frontend-spec.md` L406.
 */
import { z } from "zod"
import { apiFetch } from "@/lib/api"

export const notificationSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  resource_type: z.string(),
  resource_id: z.number(),
  event_type: z.string(),
  title: z.string(),
  body: z.string().nullish(),
  read: z.boolean(),
  created_at: z.string(),
})

export type NotificationRow = z.infer<typeof notificationSchema>

const statusSchema = z.object({ status: z.string() })

export function fetchNotifications(signal?: AbortSignal): Promise<NotificationRow[]> {
  return apiFetch<NotificationRow[]>("/notifications/", {
    schema: z.array(notificationSchema),
    signal,
  })
}

export function markNotificationRead(id: number): Promise<NotificationRow> {
  return apiFetch<NotificationRow>(`/notifications/${id}/read`, {
    method: "POST",
    body: {},
    schema: notificationSchema,
  })
}

export function markAllNotificationsRead(): Promise<{ status: string }> {
  return apiFetch(`/notifications/read-all`, { method: "POST", body: {}, schema: statusSchema })
}

export function deleteNotification(id: number): Promise<{ status: string }> {
  return apiFetch(`/notifications/${id}`, { method: "DELETE", schema: statusSchema })
}

export interface ClearNotificationsResult {
  readonly deleted: number
  readonly failed: number
}

/**
 * The drawer footer "Clear" (spec L406): one `DELETE` per loaded REST row,
 * sequentially, behind the dialog's single confirmation. A failed row does not
 * stop the loop; the caller reports the counts.
 */
export async function clearNotifications(
  rows: readonly Pick<NotificationRow, "id">[],
  deleteRow: (id: number) => Promise<unknown> = deleteNotification,
): Promise<ClearNotificationsResult> {
  let deleted = 0
  let failed = 0

  for (const row of rows) {
    try {
      await deleteRow(row.id)
      deleted += 1
    } catch {
      failed += 1
    }
  }

  return { deleted, failed }
}
