/**
 * WebSocket event types and validation.
 * Defines the contract for real-time server events.
 */

/**
 * @module lib/ws-events
 *
 * WebSocket event schemas and validation for real-time server communication.
 */
import { z } from "zod";

// ── Event schemas ──────────────────────────────────────────────────

/** Factory to avoid repeating the same schema shape for each entity type. */
function createEventSchema(eventNames: readonly string[]) {
	return z.object({
		event: z.enum(eventNames as [string, ...string[]]),
		id: z.number().optional(),
		event_id: z.string().optional(),
		timestamp: z.string().optional(),
		command: z.string().optional(),
		data: z.record(z.string(), z.any()).optional(),
	});
}

const sessionEventSchema = createEventSchema([
	"session.created",
	"session.updated",
	"session.deleted",
	"session.started",
	"session.stopped",
	"session.crashed",
]);

const autorunEventSchema = createEventSchema([
	"autorun.created",
	"autorun.updated",
	"autorun.deleted",
]);

const recordingEventSchema = createEventSchema([
	"recording.created",
	"recording.updated",
	"recording.deleted",
]);

const profileEventSchema = createEventSchema([
	"profile.created",
	"profile.updated",
	"profile.deleted",
]);

const telemetryEventSchema = z.object({
	event: z.string(), // e.g. "session.5.telemetry"
	session_id: z.number(),
	timestamp: z.string(),
	cpu_percent: z.number(),
	memory_bytes: z.number(),
	process_count: z.number(),
});

export const remuxProgressSchema = z.object({
	event: z.string(), // e.g. "session.5.remux.progress"
	session_id: z.number(),
	percent: z.number(),
	eta_seconds: z.number().nullable().optional(),
	speed: z.number().nullable().optional(),
	time: z.number().nullable().optional(),
	frame: z.number().nullable().optional(),
});

export type WsRemuxProgress = z.infer<typeof remuxProgressSchema>;

/** Discriminated union of all WS event types. */
export const wsEventSchema = z.discriminatedUnion("event", [
	sessionEventSchema,
	autorunEventSchema,
	recordingEventSchema,
	profileEventSchema,
]);

/** Any valid WS event — sessions, autoruns, recordings, profiles. */
export type WsEvent = z.infer<typeof wsEventSchema>;

/** Telemetry events (aggregated per-session). */
export type WsTelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** All possible event type strings. */
export type WsEventType = WsEvent["event"];

// ── Event → Query Key mapping ──────────────────────────────────────

/** Maps each WS event to the query keys it should invalidate. */
export const EVENT_TO_QUERY_KEY: Record<string, readonly string[]> = {
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
} as const;

/** Check if a WS event name is a known telemetry event. */
export function isTelemetryEvent(event: string): boolean {
	return event.includes(".telemetry");
}

/** Check if a WS event name is a remux progress event (`session.{id}.remux.progress`). */
export function isRemuxProgressEvent(event: string): boolean {
	return event.endsWith(".remux.progress");
}

/** Validate a raw WS message against the remux-progress schema. */
export function validateRemuxProgress(data: unknown): WsRemuxProgress | null {
	const result = remuxProgressSchema.safeParse(data);
	return result.success ? result.data : null;
}

/** Validate a raw WS message against the telemetry schema. */
export function validateTelemetryEvent(data: unknown): WsTelemetryEvent | null {
	const result = telemetryEventSchema.safeParse(data);
	return result.success ? result.data : null;
}

// ── Notification schema ────────────────────────────────────────────

export const wsNotificationSchema = z.object({
	type: z.literal("notification"),
	data: z.object({
		id: z.number().optional(),
		resource_type: z.string(),
		resource_id: z.number(),
		event_type: z.string(),
		title: z.string(),
		body: z.string().optional(),
		created_at: z.string().optional(),
	}),
});

export type WsNotification = z.infer<typeof wsNotificationSchema>;
