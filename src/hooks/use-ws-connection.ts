/**
 * Shared WebSocket connection hook.
 * Encapsulates the connect/reconnect/cleanup/auth logic duplicated
 * between use-ws-events.ts and use-ws-notifications.ts.
 */
import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";

interface UseWsConnectionOptions {
	/** URL builder function (e.g. getWsEventsUrl) */
	url: string;
	/** Called when a message is received */
	onMessage: (ev: MessageEvent) => void;
	/** Token to watch for auth changes */
	token: string | null;
}

export function useWsConnection({
	url,
	onMessage,
	token,
}: UseWsConnectionOptions) {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
	const onMessageRef = useRef(onMessage);
	const reconnectAttempts = useRef(0);

	useEffect(() => {
		onMessageRef.current = onMessage;
	}, [onMessage]);

	const connect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		try {
			const ws = new WebSocket(url);
			wsRef.current = ws;

			ws.onmessage = (ev) => onMessageRef.current(ev);

			ws.onopen = () => {
				reconnectAttempts.current = 0;
			};

			ws.onclose = (ev) => {
				// 4001 = Authentication required — don't reconnect, trigger logout
				if (ev.code === 4001) {
					useAuthStore.getState().logout();
					return;
				}
				if (wsRef.current === ws && useAuthStore.getState().isAuthenticated) {
					// Start with 1s delay, then exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
					const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
					reconnectAttempts.current++;
					reconnectTimeout.current = setTimeout(connect, delay);
				}
			};

			ws.onerror = () => ws.close();
		} catch {
			if (useAuthStore.getState().isAuthenticated) {
				const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
				reconnectAttempts.current++;
				reconnectTimeout.current = setTimeout(connect, delay);
			}
		}
	}, [url]);
	useEffect(() => {
		if (token) connect();

		return () => {
			clearTimeout(reconnectTimeout.current);
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [token, connect]);
}
