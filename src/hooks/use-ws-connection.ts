/**
 * Shared WebSocket connection hook.
 * Encapsulates the connect/reconnect/cleanup/auth logic duplicated
 * between use-ws-events.ts and use-ws-notifications.ts.
 */
import { useEffect, useRef, useCallback } from "react";
import { getStoredToken } from "@/lib/storage";
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
    const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();

    const connect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onmessage = onMessage;

            ws.onclose = () => {
                if (
                    wsRef.current === ws &&
                    useAuthStore.getState().isAuthenticated
                ) {
                    reconnectTimeout.current = setTimeout(connect, 3000);
                }
            };

            ws.onerror = () => ws.close();
        } catch {
            if (useAuthStore.getState().isAuthenticated) {
                reconnectTimeout.current = setTimeout(connect, 3000);
            }
        }
    }, [url, onMessage]);

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
