import { useState, useCallback } from "react";
import { getWsNotificationsUrl } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";
import { useWsConnection } from "@/hooks/use-ws-connection";
import type { Notification } from "@/lib/schemas";

/**
 * Connects to /ws/notifications WebSocket and maintains a live list of
 * unread notifications for the current user.
 */
export function useWsNotifications() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const token = useAuthStore((s) => s.token);

    const onMessage = useCallback((ev: MessageEvent) => {
        try {
            const data = JSON.parse(ev.data);
            if (data.type === "notification" && data.data) {
                const notif: Notification = data.data;
                setNotifications((prev) => {
                    if (prev.some((n) => n.id === notif.id)) return prev;
                    return [notif, ...prev];
                });
                useRequestLogStore.getState().addEntry({
                    type: "ws-notif",
                    timestamp: Date.now(),
                    method: "WS",
                    url: "/ws/notifications",
                    path: data.data.event_type ?? "notification",
                    status: 200,
                    statusText: "OK",
                    duration: null,
                    ok: true,
                    error: null,
                    requestBody: null,
                    responseBody: JSON.stringify(data),
                });
            }
        } catch {
            // ignore
        }
    }, []);

    useWsConnection({ url: getWsNotificationsUrl(), onMessage, token });

    const markRead = useCallback((id: number) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setNotifications([]);
    }, []);

    return { notifications, markRead, clearAll };
}
