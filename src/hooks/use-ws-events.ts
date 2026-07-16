import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useWsConnection } from "@/hooks/use-ws-connection";
import { getWsEventsUrl } from "@/lib/api";
import type { WsEventType } from "@/lib/ws-events";
import { EVENT_TO_QUERY_KEY, wsEventSchema } from "@/lib/ws-events";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";

interface WsEvent {
	event: WsEventType;
	id?: number;
	event_id?: string;
	timestamp?: string;
	command?: string;
	/** Full entity payload from the backend for zero-roundtrip updates. */
	data?: Record<string, unknown>;
}

// ── Cache helpers ──────────────────────────────────────────────────

/**
 * Patch the TanStack Query cache with entity data received over WS.
 * All NATS events are emitted after DB commit — they're authoritative.
 *
 * - Creates / updates → replace or append in list cache (zero round-trip)
 * - Deletes → remove from list cache by ID (zero round-trip)
 * - Missing data → invalidate as fallback (enrichment failure)
 *
 * Uses setQueryData with updater functions to avoid race conditions
 * when multiple events arrive in quick succession for the same query key.
 */
function patchQueryCache(
	queryClient: ReturnType<typeof useQueryClient>,
	event: WsEvent,
) {
	const queryKey: QueryKey = EVENT_TO_QUERY_KEY[event.event];
	if (!queryKey) return;

	const isDelete = event.event.endsWith(".deleted");

	// Deletes — remove the entity from cache by ID.
	// The NATS event is emitted after DB commit, so it's authoritative.
	if (isDelete && event.id !== undefined) {
		queryClient.setQueryData<unknown[]>(queryKey, (old) => {
			if (!old) return old;
			return old.filter(
				(item) => (item as Record<string, unknown>)?.id !== event.id,
			);
		});
		return;
	}

	// Creates / updates carry the full entity payload — patch the list cache
	// directly with zero HTTP round-trip.
	if (event.data) {
		queryClient.setQueryData<unknown[]>(queryKey, (old) => {
			if (!old) return old; // cache not mounted yet — fall back to refetch
			const arr = [...old];
			const idx = arr.findIndex(
				(item) => (item as Record<string, unknown>)?.id === event.id,
			);
			if (idx >= 0) {
				// Replace existing item with fresh data
				arr[idx] = event.data;
			} else {
				// Append new entity
				arr.unshift(event.data);
			}
			return arr;
		});
		return;
	}

	// Fallback: no data payload available (enrichment failed on the backend).
	// Invalidate so React Query re-fetches.
	queryClient.invalidateQueries({ queryKey });
}

// ── Batch processor ──────────────────────────────────────────────

/**
 * Batches WS events to avoid race conditions when multiple events
 * arrive in quick succession. Processes events in a microtask to
 * coalesce rapid updates to the same query key.
 */
class WsEventBatcher {
	private pending = new Map<string, WsEvent>();
	private flushScheduled = false;
	private queryClient: ReturnType<typeof useQueryClient>;

	constructor(queryClient: ReturnType<typeof useQueryClient>) {
		this.queryClient = queryClient;
	}

	add(event: WsEvent) {
		const key = `${event.event}:${event.id ?? "none"}`;
		// Keep only the latest event for each entity (most recent wins)
		this.pending.set(key, event);
		this.scheduleFlush();
	}

	private scheduleFlush() {
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		// Use microtask to coalesce rapid updates
		queueMicrotask(() => this.flush());
	}

	private flush() {
		this.flushScheduled = false;
		const events = Array.from(this.pending.values());
		this.pending.clear();

		for (const event of events) {
			patchQueryCache(this.queryClient, event);
		}
	}
}

/**
 * Connects to the /ws/events WebSocket and patches TanStack Query caches
 * with entity data received over the wire — no round-trip needed.
 *
 * Falls back to invalidating the query when entity data is unavailable.
 */
export function useWsEvents() {
	const queryClient = useQueryClient();
	const token = useAuthStore((s) => s.token);
	const batcherRef = useRef<WsEventBatcher | null>(null);

	// Initialize batcher once
	if (!batcherRef.current) {
		batcherRef.current = new WsEventBatcher(queryClient);
	}

	const onMessage = useCallback(
		(ev: MessageEvent) => {
			try {
				const parsed = JSON.parse(ev.data);
				const result = wsEventSchema.safeParse(parsed);
				if (result.success) {
					batcherRef.current!.add(result.data);
					useRequestLogStore.getState().addEntry({
						type: "ws-event",
						timestamp: Date.now(),
						method: "WS",
						url: "/ws/events",
						path: result.data.event ?? "unknown",
						status: 200,
						statusText: "OK",
						duration: null,
						ok: true,
						error: null,
						requestBody: null,
						responseBody: JSON.stringify(result.data),
					});
				} else {
					// Invalid event — log and ignore
					console.debug("Invalid WS event ignored:", result.error.issues);
				}
			} catch {
				// ignore non-JSON messages
			}
		},
		[queryClient],
	);

	useWsConnection({ url: getWsEventsUrl(), onMessage, token });
}
