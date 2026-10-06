import { z } from "zod"

/**
 * REST notification row (`GET /notifications/`, mark-read/delete targets).
 * Always carries `id`/`body`/`read`.
 */
export const NotificationSchema = z
  .object({
    id: z.number(),
    user_id: z.number().optional(),
    resource_type: z.string(),
    resource_id: z.number(),
    event_type: z.string(),
    title: z.string(),
    body: z.string().optional(),
    read: z.boolean().optional(),
    created_at: z.string(),
  })
  .passthrough()

export type Notification = z.infer<typeof NotificationSchema>

/**
 * Synthetic `/ws/notifications` frame — exactly these five fields, never
 * `id`/`body`/`read` (contract §Notifications feed). Never joined to REST
 * rows on `id`; dedupe is by `(resource_type, resource_id, event_type)`.
 */
export const NotificationFrameSchema = z
  .object({
    resource_type: z.string(),
    resource_id: z.number(),
    event_type: z.string(),
    title: z.string(),
    created_at: z.string(),
  })
  .passthrough()

export type NotificationFrame = z.infer<typeof NotificationFrameSchema>
