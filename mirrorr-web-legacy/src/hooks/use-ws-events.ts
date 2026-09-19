import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useWsConnection } from "@/hooks/use-ws-connection";
import { getWsEventsUrl } from "@/lib/api";
import {
	autorunSchema,
	profileSchema,
	recordingSchema,
	sessionSchema,
} from "@/lib/schemas";
import type { WsEventType } from "@/lib/ws-events";
import { EVENT_TO_QUERY_KEY, wsEventSchema } from "@/lib/ws-events";
import {
	isRemuxProgressEvent,
	validateRemuxProgress,
} from "@/lib/ws-events";
import { useRemuxProgressStore } from "@/stores/remux-progress-store";
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

// ── Entity schema selection ────────────────────────────────────────

/**
 * Maps an event name to the Zod schema that validates its `data` payload.
 * Returns `null` for events that never carry entity data (e.g. telemetry).
 */
function schemaForEvent(eventName: string) {
	if (eventName.startsWith("session.")) return sessionSchema;
	if (eventName.startsWith("autorun.")) return autorunSchema;
	if (eventName.startsWith("recording.")) return recordingSchema;
	if (eventName.startsWith("profile.")) return profileSchema;
	return null;
}

/**
 * Maps an event name to the detail query key for that entity.
 * e.g. "session.updated" with id=5 → ["sessions", 5]
 * Returns `null` if the event has no detail-query equivalent.
 */
function detailQueryKey(eventName: string, id: number | undefined) {
	if (id === undefined) return null;
	if (eventName.startsWith("session.")) return ["sessions", id];
	if (eventName.startsWith("autorun.")) return ["autoruns", id];
	if (eventName.startsWith("recording.")) return ["recordings", id];
	if (eventName.startsWith("profile.")) return ["profiles", id];
	return null;
}

// ── Cache helpers ──────────────────────────────────────────────────

/**
 * Patch the TanStack Query cache with entity data received over WS.
 * All NATS events are emitted after DB commit — they're authoritative.
 *
 * - Creates / updates → replace or append in list cache (zero round-trip)
 *                    → also patch the detail cache (["entity", id])
 * - Deletes → remove from list cache by ID + remove detail cache
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
		// Also remove the detail query cache for this entity
		const detailKey = detailQueryKey(event.event, event.id);
		if (detailKey) {
			queryClient.removeQueries({ queryKey: detailKey });
		}
		return;
	}

	// Creates / updates carry the full entity payload — patch the list cache
	// directly with zero HTTP round-trip. Validate against the entity schema
	// first to catch backend/frontend contract drift early.
	if (event.data) {
		const schema = schemaForEvent(event.event);
		const validated = schema ? schema.safeParse(event.data) : null;
		if (validated && !validated.success) {
			// Schema drift — log and fall back to invalidation so the next
			// fetch either repairs the cache or surfaces the real error.
			console.warn(
				`[ws-events] ${event.event} payload failed schema validation — falling back to invalidate:`,
				validated.error.issues,
			);
			queryClient.invalidateQueries({ queryKey });
			return;
		}
		const payload = validated?.success ? validated.data : event.data;

		queryClient.setQueryData<unknown[]>(queryKey, (old) => {
			if (!old) return old; // cache not mounted yet — fall back to refetch
			const arr = [...old];
			const idx = arr.findIndex(
				(item) => (item as Record<string, unknown>)?.id === event.id,
			);
			if (idx >= 0) {
				// Replace existing item with fresh data
				arr[idx] = payload;
			} else {
				// Append new entity
				arr.unshift(payload);
			}
			return arr;
		});

		// Also patch the detail query (e.g. ["sessions", id]) so pages like
		// the monitoring detail view stay live without a 30s staleTime wait.
		const detailKey = detailQueryKey(event.event, event.id);
		if (detailKey) {
			queryClient.setQueryData(detailKey, payload);
		}
		return;
	}

	// Fallback: no data payload available (enrichment failed on the backend).
	// Invalidate so React Query re-fetches.
	queryClient.invalidateQueries({ queryKey });
	const detailKey = detailQueryKey(event.event, event.id);
	if (detailKey) {
		queryClient.invalidateQueries({ queryKey: detailKey });
	}
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
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	const [batcher] = useState(() => new WsEventBatcher(queryClient));

	const onMessage = useCallback((ev: MessageEvent) => {
		try {
			const parsed = JSON.parse(ev.data);
			if (
				typeof parsed?.event === "string" &&
				isRemuxProgressEvent(parsed.event)
			) {
				const prog = validateRemuxProgress(parsed);
				if (prog) {
					useRemuxProgressStore.getState().setProgress(prog.session_id, {
						percent: prog.percent,
						eta_seconds: prog.eta_seconds ?? null,
						speed: prog.speed ?? null,
						time: prog.time ?? null,
						frame: prog.frame ?? null,
					});
				} else {
					console.debug("Invalid remux.progress ignored:", parsed);
				}
				return;
			}
			const result = wsEventSchema.safeParse(parsed);
			if (result.success) {
				batcher.add(result.data);
				const status =
					(parsed as Record<string, unknown>)?.status ??
					(result.data.data as Record<string, unknown> | undefined)?.status;
				const id = result.data.id;
				if (
					id !== undefined &&
					(status === "completed" || status === "failed")
				) {
					useRemuxProgressStore.getState().clearProgress(id);
				}
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
	}, []);

	useWsConnection({ url: getWsEventsUrl(), onMessage, isAuthenticated });
}
