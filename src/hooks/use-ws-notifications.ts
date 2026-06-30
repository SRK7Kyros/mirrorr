import { useEffect, useRef, useCallback, useState } from "react"
import { getWsNotificationsUrl } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { Notification } from "@/lib/schemas"

/**
 * Connects to /ws/notifications WebSocket and maintains a live list of
 * unread notifications for the current user.
 */
export function useWsNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>()
  const token = useAuthStore((s) => s.token)

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      const url = getWsNotificationsUrl()
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.type === "notification" && data.data) {
            const notif: Notification = data.data
            setNotifications((prev) => {
              // Deduplicate by id
              if (prev.some((n) => n.id === notif.id)) return prev
              return [notif, ...prev]
            })
          }
        } catch {
          // ignore
        }
      }

      ws.onclose = () => {
        if (useAuthStore.getState().isAuthenticated) {
          reconnectTimeout.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => ws.close()
    } catch {
      if (useAuthStore.getState().isAuthenticated) {
        reconnectTimeout.current = setTimeout(connect, 3000)
      }
    }
  }, [])

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

  const markRead = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  return { notifications, markRead, clearAll }
}
