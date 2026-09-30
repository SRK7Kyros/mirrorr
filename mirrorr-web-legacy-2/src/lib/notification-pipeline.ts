/**
 * The `/ws/notifications` pipeline: raw socket frames feed the badge's
 * synthetic component and a coalesced refresh of the drawer's REST feed.
 *
 * Contract: `docs/web-frontend-spec.md` L195 — the server flushes all unread
 * notifications on connect and then pushes new ones; a pushed frame is counted
 * once per tuple, a matching REST row stops counting, the drawer stays
 * REST-only, and the badge arithmetic never depends on the socket being up.
 * `docs/general-client-specification.md` §11.2/§13.10.2 — the frame carries
 * `(resource_type, resource_id, event_type, title, created_at)` and the client
 * must not require or read `id`/`body`/`read`. The reconnect-to-live transition
 * re-reads the server's connect-time flush (idempotent: tuple dedupe for the
 * badge, row identity for the drawer).
 */
import type { QueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { handleNotificationFrame, type NotificationFrame } from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { subscribeRealtimeFrames, type RealtimeFrame } from "@/lib/realtime-manager"
import {
  getRealtimeStatus,
  subscribeToRealtimeStatus,
  type RealtimeStatus,
} from "@/lib/realtime-status"

/** Pushed frames inside one window trigger a single drawer refresh. */
export const NOTIFICATION_FLUSH_COALESCE_MS = 30

const notificationFrameSchema = z
  .object({
    type: z.literal("notification").nullish(),
    data: z
      .object({
        resource_type: z.string().nullish(),
        resource_id: z.number().int().nullish(),
        event_type: z.string(),
        title: z.string(),
        created_at: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough()

export function parseNotificationFrame(payload: unknown): NotificationFrame | null {
  const parsed = notificationFrameSchema.safeParse(payload)
  if (!parsed.success) return null

  const { resource_type, resource_id, event_type, title, created_at } = parsed.data.data
  return {
    event_type,
    title,
    ...(typeof resource_type === "string" ? { resource_type } : {}),
    ...(typeof resource_id === "number" ? { resource_id } : {}),
    ...(typeof created_at === "string" ? { created_at } : {}),
  }
}

export interface NotificationPipelineOptions {
  readonly queryClient: Pick<QueryClient, "invalidateQueries">
  /** Overridable for tests; defaults to the realtime manager's frame bus. */
  readonly subscribe?: (listener: (frame: RealtimeFrame) => void) => () => void
  /** Overridable for tests; defaults to the realtime-status module. */
  readonly subscribeStatus?: (listener: () => void) => () => void
  readonly getStatus?: () => RealtimeStatus
  /** Overridable for tests; defaults to `handleNotificationFrame`. */
  readonly handleFrame?: (frame: NotificationFrame) => boolean
  /** Overridable for tests; defaults to invalidating the notifications query. */
  readonly refresh?: () => void
  readonly coalesceMs?: number
}

export function installNotificationPipeline(options: NotificationPipelineOptions): () => void {
  const subscribe = options.subscribe ?? subscribeRealtimeFrames
  const subscribeStatus = options.subscribeStatus ?? subscribeToRealtimeStatus
  const getStatus = options.getStatus ?? getRealtimeStatus
  const handleFrame = options.handleFrame ?? handleNotificationFrame
  const refresh =
    options.refresh ??
    (() => {
      void options.queryClient.invalidateQueries({ queryKey: queryKeys.notifications() })
    })
  const coalesceMs = options.coalesceMs ?? NOTIFICATION_FLUSH_COALESCE_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  const scheduleRefresh = (): void => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      refresh()
    }, coalesceMs)
  }

  const unsubscribeFrames = subscribe((frame) => {
    if (frame.role !== "notifications") return
    const parsed = parseNotificationFrame(frame.payload)
    if (parsed === null) return
    handleFrame(parsed)
    scheduleRefresh()
  })

  let lastStatus = getStatus()
  const unsubscribeStatus = subscribeStatus(() => {
    const next = getStatus()
    const resumed = next === "live" && lastStatus !== "live"
    lastStatus = next
    if (resumed) scheduleRefresh()
  })

  return () => {
    unsubscribeFrames()
    unsubscribeStatus()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}
