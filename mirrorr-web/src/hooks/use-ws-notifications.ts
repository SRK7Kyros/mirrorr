import { useCallback, useState } from "react";
import { useWsConnection } from "@/hooks/use-ws-connection";
import { getWsNotificationsUrl, notificationsApi } from "@/lib/api";
import { notificationSchema, type Notification } from "@/lib/schemas";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";

/**
 * Connects to /ws/notifications WebSocket and maintains a live list of
 * unread notifications for the current user.
 */
export function useWsNotifications() {
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

	const onMessage = useCallback((ev: MessageEvent) => {
		try {
			const data = JSON.parse(ev.data);
			if (data.type === "notification" && data.data) {
				const result = notificationSchema.safeParse(data.data);
				if (!result.success) {
					console.debug(
						"Invalid notification data ignored:",
						result.error.issues,
					);
					return;
				}
				const notif = result.data;
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

	useWsConnection({ url: getWsNotificationsUrl(), onMessage, isAuthenticated });

	const markRead = useCallback(async (id: number) => {
		setNotifications((prev) => prev.filter((n) => n.id !== id));
		try {
			await notificationsApi.markRead(id);
		} catch {
			// Best-effort persistence: the local dismissal already applied.
		}
	}, []);

	const clearAll = useCallback(async () => {
		setNotifications([]);
		try {
			await notificationsApi.markAllRead();
		} catch {
			// Best-effort persistence: the local dismissal already applied.
		}
	}, []);

	return { notifications, markRead, clearAll };
}
