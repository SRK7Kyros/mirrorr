import { useEffect, useRef, useCallback } from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { getWsEventsUrl } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { useRequestLogStore } from "@/stores/request-log-store"

type WsEventType =
  | "session.created" | "session.updated" | "session.deleted"
  | "session.started" | "session.stopped" | "session.crashed"
  | "autorun.created" | "autorun.updated" | "autorun.deleted"
  | "recording.created" | "recording.updated" | "recording.deleted"
  | "profile.created" | "profile.updated" | "profile.deleted"

interface WsEvent {
  event: WsEventType
  id?: number
  event_id?: string
  timestamp?: string
  command?: string
  /** Full entity payload from the backend for zero-roundtrip updates. */
  data?: Record<string, unknown>
}

const EVENT_TO_QUERY_KEY: Record<string, string[]> = {
  "session.created": ["sessions"],
  "session.updated": ["sessions"],
  "session.deleted": ["sessions"],
  "session.started": ["sessions"],
  "session.stopped": ["sessions"],
  "session.crashed": ["sessions"],
  "autorun.created": ["autoruns"],
  "autorun.updated": ["autoruns"],
  "autorun.deleted": ["autoruns"],
  "recording.created": ["recordings"],
  "recording.updated": ["recordings"],
  "recording.deleted": ["recordings"],
  "profile.created": ["profiles"],
  "profile.updated": ["profiles"],
  "profile.deleted": ["profiles"],
}

// ── Cache helpers ──────────────────────────────────────────────────

/**
 * Patch the TanStack Query cache with entity data received over WS.
 * All NATS events are emitted after DB commit — they're authoritative.
 *
 * - Creates / updates → replace or append in list cache (zero round-trip)
 * - Deletes → remove from list cache by ID (zero round-trip)
 * - Missing data → invalidate as fallback (enrichment failure)
 */
function patchQueryCache(
  queryClient: ReturnType<typeof useQueryClient>,
  event: WsEvent,
) {
  const queryKey: QueryKey = EVENT_TO_QUERY_KEY[event.event]
  if (!queryKey) return

  const isDelete = event.event.endsWith(".deleted")

  // Deletes — remove the entity from cache by ID.
  // The NATS event is emitted after DB commit, so it's authoritative.
  if (isDelete && event.id !== undefined) {
    queryClient.setQueryData<unknown[]>(queryKey, (old) => {
      if (!old) return old
      return old.filter((item: any) => item?.id !== event.id)
    })
    return
  }

  // Creates / updates carry the full entity payload — patch the list cache
  // directly with zero HTTP round-trip.
  if (event.data) {
    queryClient.setQueryData<unknown[]>(queryKey, (old) => {
      if (!old) return old // cache not mounted yet — fall back to refetch
      const arr = [...old]
      const idx = arr.findIndex(
        (item: any) => item?.id === event.id,
      )
      if (idx >= 0) {
        // Replace existing item with fresh data
        arr[idx] = event.data
      } else {
        // Append new entity
        arr.unshift(event.data)
      }
      return arr
    })
    return
  }

  // Fallback: no data payload available (enrichment failed on the backend).
  // Invalidate so React Query re-fetches.
  queryClient.invalidateQueries({ queryKey })
}

/**
 * Connects to the /ws/events WebSocket and patches TanStack Query caches
 * with entity data received over the wire — no round-trip needed.
 *
 * Falls back to invalidating the query when entity data is unavailable.
 */
export function useWsEvents() {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>()
  const token = useAuthStore((s) => s.token)

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      const url = getWsEventsUrl()
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as WsEvent
          patchQueryCache(queryClient, data)
          // Log WS event to network monitor
          useRequestLogStore.getState().addEntry({
            type: "ws-event",
            timestamp: Date.now(),
            method: "WS",
            url: "/ws/events",
            path: data.event ?? "unknown",
            status: 200,
            statusText: "OK",
            duration: null,
            ok: true,
            error: null,
            requestBody: null,
            responseBody: JSON.stringify(data),
          })
        } catch {
          // ignore non-JSON messages
        }
      }

      ws.onclose = () => {
        // Only reconnect if this WS is still the active one.
        // If wsRef.current was nulled by cleanup, this close was intentional.
        if (wsRef.current === ws && useAuthStore.getState().isAuthenticated) {
          reconnectTimeout.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      // WS connection failed — retry
      if (useAuthStore.getState().isAuthenticated) {
        reconnectTimeout.current = setTimeout(connect, 3000)
      }
    }
  }, [queryClient])

  useEffect(() => {
    if (token) {
      connect()
    }

    return () => {
      clearTimeout(reconnectTimeout.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [token, connect])
}
