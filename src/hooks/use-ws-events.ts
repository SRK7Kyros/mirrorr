import { useEffect, useRef, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
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

/**
 * Connects to the /ws/events WebSocket and invalidates TanStack Query caches
 * whenever a relevant resource event arrives.
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
          const queryKey = EVENT_TO_QUERY_KEY[data.event]
          if (queryKey) {
            queryClient.invalidateQueries({ queryKey })
          }
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
