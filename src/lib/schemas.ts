import { z } from "zod";

// ── Auth ───────────────────────────────────────────────────────────

export const loginSchema = z.object({
	username: z.string().min(1, "Username is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = z.object({
	username: z.string().min(1, "Username is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
	display_name: z.string().optional(),
});

export const changePasswordSchema = z
	.object({
		old_password: z.string().min(1, "Current password is required"),
		new_password: z.string().min(8, "Password must be at least 8 characters"),
		confirm_password: z
			.string()
			.min(8, "Password must be at least 8 characters"),
	})
	.refine((data) => data.new_password === data.confirm_password, {
		message: "Passwords do not match",
		path: ["confirm_password"],
	});

// ── User ───────────────────────────────────────────────────────────

export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	role: z.enum(["admin", "user"]),
	display_name: z.string(),
	created_at: z.string().optional(),
});

export type User = z.infer<typeof userSchema>;

// ── Auth Status ────────────────────────────────────────────────────

export const authStatusSchema = z.object({
	has_users: z.boolean(),
});

export const meSchema = z.object({
	user: userSchema,
	client: z.object({ id: z.number(), name: z.string() }).nullable(),
});

// ── Registration Request ───────────────────────────────────────────

export const registrationRequestSchema = z.object({
	id: z.number(),
	username: z.string(),
	display_name: z.string(),
	status: z.enum(["pending", "approved", "denied"]),
	created_at: z.string(),
	reviewed_at: z.string().nullable(),
	reviewed_by: z.string().nullable(),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;

// ── Engine ─────────────────────────────────────────────────────────

export const engineCapabilitiesSchema = z.object({
	can_record: z.boolean(),
	can_playlist: z.boolean(),
});

export const engineSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	origin: z.string(),
	origin_hash: z.string(),
	capabilities: engineCapabilitiesSchema,
	retry_modes_schema: z.record(z.string(), z.any()),
});

export type Engine = z.infer<typeof engineSchema>;

// ── Resolver ───────────────────────────────────────────────────────

export const resolverSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string(),
	origin: z.string(),
	origin_hash: z.string(),
	config_schema: z.record(z.string(), z.any()),
});

export type Resolver = z.infer<typeof resolverSchema>;

// ── Profile ────────────────────────────────────────────────────────

export const profileSchema = z.object({
	id: z.number(),
	name: z.string(),
	default_engine_id: z.number(),
	resolver_id: z.number(),
	resolver_config: z.record(z.string(), z.any()),
	retry_mode: z.string(),
	retry_config: z.record(z.string(), z.any()),
});

export type Profile = z.infer<typeof profileSchema>;

export const createProfileSchema = z.object({
	name: z.string().min(1, "Name is required"),
	default_engine_id: z.number({ message: "Engine is required" }),
	resolver_id: z.number({ message: "Resolver is required" }),
	resolver_config: z.record(z.string(), z.any()).default({}),
	retry_mode: z.string().default("none"),
	retry_config: z.record(z.string(), z.any()).default({}),
});

// ── Session ────────────────────────────────────────────────────────

export const sessionStatusSchema = z.enum([
	"active",
	"recording",
	"terminating",
	"remuxing",
	"finalizing",
	"completed",
	"failed",
]);

const attemptSchema = z.object({
	index: z.number(),
	started_at: z.string().optional(),
	ended_at: z.string().optional(),
	duration_seconds: z.number().optional(),
	returncode: z.number().nullable().optional(),
	reason: z.string().nullable().optional(),
});

export const sessionSchema = z.object({
	id: z.number(),
	profile_id: z.number().nullable(),
	autorun_id: z.number().nullable(),
	engine_id: z.number(),
	resolver_id: z.number(),
	resolver_config: z.record(z.string(), z.any()),
	retry_mode: z.string(),
	retry_config: z.record(z.string(), z.any()),
	status: sessionStatusSchema,
	recording: z.boolean(),
	retry_attempts: z.number(),
	started_at: z.string().nullable(),
	ended_at: z.string().nullable(),
	requester_user_token: z.string().optional(),
	session_urls: z.array(z.object({ label: z.string(), url: z.string() })),
	attempts: z.array(attemptSchema).default([]),
});

export type Session = z.infer<typeof sessionSchema>;

export const createSessionSchema = z.object({
	profile_id: z.number().optional(),
	engine_id: z.number({ message: "Engine is required" }),
	resolver_id: z.number({ message: "Resolver is required" }),
	resolver_config: z.record(z.string(), z.any()).default({}),
	retry_mode: z.string().default("none"),
	retry_config: z.record(z.string(), z.any()).default({}),
	recording: z.boolean().default(false),
});

// ── Autorun ────────────────────────────────────────────────────────

export const autorunSchema = z.object({
	id: z.number(),
	user_friendly_name: z.string(),
	snake_case_name: z.string(),
	profile_id: z.number().nullable(),
	engine_id: z.number(),
	resolver_id: z.number(),
	resolver_config: z.record(z.string(), z.any()),
	retry_mode: z.string(),
	retry_config: z.record(z.string(), z.any()),
	status: z.enum(["scheduled", "active", "recording", "terminating", "remuxing", "finalizing", "completed", "failed"]).default("scheduled"),
	start_time: z.string(),
	end_time: z.string(),
	recording: z.boolean(),
});

export type Autorun = z.infer<typeof autorunSchema>;

export const createAutorunSchema = z.object({
	user_friendly_name: z.string().min(1, "Name is required"),
	snake_case_name: z.string().min(1, "Slug is required"),
	profile_id: z.number().optional(),
	engine_id: z.number({ message: "Engine is required" }),
	resolver_id: z.number({ message: "Resolver is required" }),
	resolver_config: z.record(z.string(), z.any()).default({}),
	retry_mode: z.string().default("none"),
	retry_config: z.record(z.string(), z.any()).default({}),
	start_time: z.string().min(1, "Start time is required"),
	end_time: z.string().min(1, "End time is required"),
	recording: z.boolean().default(true),
});

// ── Recording ──────────────────────────────────────────────────────

export const recordingSchema = z.object({
	id: z.number(),
	user_friendly_name: z.string(),
	snake_case_name: z.string(),
	disk_path: z.string(),
	content_url: z.string(),
	profile_name: z.string(),
	engine_name: z.string(),
	resolver_name: z.string(),
	started_at: z.string(),
	ended_at: z.string(),
	duration_seconds: z.number(),
	size_bytes: z.number(),
	created_at: z.string(),
});

export type Recording = z.infer<typeof recordingSchema>;

// ── Notification ───────────────────────────────────────────────────

export const notificationSchema = z.object({
	id: z.number(),
	resource_type: z.string(),
	resource_id: z.number(),
	event_type: z.string(),
	title: z.string(),
	body: z.string(),
	read: z.boolean(),
	created_at: z.string(),
});

export type Notification = z.infer<typeof notificationSchema>;

// ── Telemetry ─────────────────────────────────────────────────────

export const telemetrySystemSchema = z.object({
	total_cpu_percent: z.number(),
	total_memory_bytes: z.number(),
	total_processes: z.number(),
	active_sessions: z.number(),
});

export type TelemetrySystem = z.infer<typeof telemetrySystemSchema>;

export const telemetrySampleSchema = z.object({
	id: z.number(),
	session_id: z.number(),
	timestamp: z.string(),
	cpu_percent: z.number(),
	memory_bytes: z.number(),
	process_count: z.number(),
});

export type TelemetrySample = z.infer<typeof telemetrySampleSchema>;

// ── Import/Export ─────────────────────────────────────────────────

export const importBundleSchema = z.object({
	profiles: z.array(z.record(z.string(), z.unknown())).optional(),
	autoruns: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type ImportBundle = z.infer<typeof importBundleSchema>;

export const validationReportSchema = z.object({
	valid: z.boolean(),
	profiles: z.array(
		z.object({
			name: z.string(),
			content_hash: z.string(),
			valid: z.boolean(),
			issues: z.array(
				z.object({
					field: z.string().optional(),
					problem: z.string(),
					bundled: z
						.object({ name: z.string(), origin_hash: z.string() })
						.optional(),
					installed: z
						.object({ name: z.string(), origin_hash: z.string() })
						.optional(),
					alternatives: z
						.array(
							z.object({
								id: z.number(),
								name: z.string(),
								origin_hash: z.string(),
							}),
						)
						.optional(),
					existing_id: z.number().optional(),
					profile_name: z.string().optional(),
					new_name: z.string().optional(),
				}),
			),
		}),
	),
	autoruns: z.array(
		z.object({
			name: z.string(),
			valid: z.boolean(),
			issues: z.array(
				z.object({
					field: z.string().optional(),
					problem: z.string(),
					bundled: z
						.object({ name: z.string(), origin_hash: z.string() })
						.optional(),
					installed: z
						.object({ name: z.string(), origin_hash: z.string() })
						.optional(),
					alternatives: z
						.array(
							z.object({
								id: z.number(),
								name: z.string(),
								origin_hash: z.string(),
							}),
						)
						.optional(),
					profile_name: z.string().optional(),
				}),
			),
		}),
	),
});

export type ValidationReport = z.infer<typeof validationReportSchema>;
