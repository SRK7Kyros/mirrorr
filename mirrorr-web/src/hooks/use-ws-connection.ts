import { useCallback, useEffect, useRef } from "react";
import { getBearerForActive } from "@/lib/token-store";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";

interface UseWsConnectionOptions {
	url: string;
	onMessage: (ev: MessageEvent) => void;
	isAuthenticated: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 12;
const KEEPALIVE_MS = 1500;
const STALE_MS = 30_000;

function reconnectDelay(attempts: number): number {
	const base = Math.min(1000 * 2 ** attempts, 30000);
	return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function healthOk(): Promise<boolean> {
	try {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), 5000);
		const res = await fetch("/health", { cache: "no-store", signal: ctl.signal });
		clearTimeout(t);
		return res.ok;
	} catch {
		return false;
	}
}

export function useWsConnection({
	url,
	onMessage,
	isAuthenticated,
}: UseWsConnectionOptions) {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
	const onMessageRef = useRef(onMessage);
	const reconnectAttempts = useRef(0);
	const lastEventAt = useRef<number>(Date.now());
	const keepaliveTimer = useRef<ReturnType<typeof setInterval>>(undefined);

	useEffect(() => {
		onMessageRef.current = onMessage;
	}, [onMessage]);

	const scheduleReconnect = useCallback(() => {
		if (document.hidden) return;
		if (!useAuthStore.getState().isAuthenticated) return;
		if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return;
		clearTimeout(reconnectTimeout.current);
		const delay = reconnectDelay(reconnectAttempts.current);
		reconnectAttempts.current++;
		reconnectTimeout.current = setTimeout(() => {
			connectRef.current();
		}, delay);
	}, []);

	const connectRef = useRef<() => void>(() => {});
	const connect = useCallback(() => {
		if (wsRef.current) {
			try {
				wsRef.current.close();
			} catch {
				// ignore
			}
			wsRef.current = null;
		}

		const openSocket = (socketUrl: string, protocols?: string | string[]) => {
			const ws = protocols
				? new WebSocket(socketUrl, protocols)
				: new WebSocket(socketUrl);
			wsRef.current = ws;

			ws.onmessage = (ev) => {
				lastEventAt.current = Date.now();
				onMessageRef.current(ev);
			};

			ws.onopen = () => {
				reconnectAttempts.current = 0;
				lastEventAt.current = Date.now();
			};

			ws.onclose = (ev) => {
				if (ev.code === 4001) {
					useRequestLogStore.getState().addEntry({
						type: "ws-event",
						timestamp: Date.now(),
						method: "WS",
						url,
						path: "close/4001",
						status: 4001,
						statusText: "Unauthorized",
						duration: null,
						ok: false,
						error: "WebSocket unauthorized (4001) — live updates off, REST still works",
						requestBody: null,
						responseBody: null,
					});
					return;
				}
				if (ev.code === 1006) {
					useRequestLogStore.getState().addEntry({
						type: "ws-event",
						timestamp: Date.now(),
						method: "WS",
						url,
						path: "close/1006",
						status: 1006,
						statusText: "Abnormal closure",
						duration: null,
						ok: false,
						error: "WebSocket closed abnormally (1006)",
						requestBody: null,
						responseBody: null,
					});
				}
				if (wsRef.current !== ws) return;
				if (document.hidden) return;
				if (!useAuthStore.getState().isAuthenticated) return;
				if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return;
				scheduleReconnect();
			};

			ws.onerror = () => {
				try {
					ws.close();
				} catch {
					// ignore
				}
			};
		};

		void (async () => {
			try {
				const bearer = await getBearerForActive();
				openSocket(url, bearer ? [bearer] : undefined);
			} catch {
				try {
					openSocket(url);
				} catch {
					scheduleReconnect();
				}
			}
		})();
	}, [url, scheduleReconnect]);

	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	useEffect(() => {
		if (!isAuthenticated) return;
		connect();

		keepaliveTimer.current = setInterval(() => {
			if (document.hidden) return;
			const ws = wsRef.current;
			if (!ws || ws.readyState !== WebSocket.OPEN) return;
			try {
				ws.send(JSON.stringify({ type: "ping", at: Date.now() }));
			} catch {
				// fire-and-forget: backend discards inbound, no pong expected
			}
		}, KEEPALIVE_MS);

		const verifyThenForce = async () => {
			if (document.hidden) return;
			if (!useAuthStore.getState().isAuthenticated) return;
			const ws = wsRef.current;
			const socketDead = !ws || ws.readyState !== WebSocket.OPEN;
			const stale = Date.now() - lastEventAt.current > STALE_MS;
			if (!socketDead && !stale) return;
			if (!socketDead && stale) {
				const ok = await healthOk();
				if (ok) return;
			}
			clearTimeout(reconnectTimeout.current);
			connectRef.current();
		};

		const onVisibility = () => {
			if (!document.hidden) void verifyThenForce();
		};
		const onPageShow = (e: PageTransitionEvent) => {
			if (e.persisted) void verifyThenForce();
			else void verifyThenForce();
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pageshow", onPageShow);

		return () => {
			clearInterval(keepaliveTimer.current);
			clearTimeout(reconnectTimeout.current);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pageshow", onPageShow);
			if (wsRef.current) {
				try {
					wsRef.current.close();
				} catch {
					// ignore
				}
				wsRef.current = null;
			}
		};
	}, [isAuthenticated, connect, scheduleReconnect]);
}
