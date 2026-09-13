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
	version: z.string().optional(),
	ready: z.boolean().optional(),
});

export const meSchema = z.object({
	user: userSchema,
	client: z.object({ id: z.number(), name: z.string() }).nullable(),
	access_token: z.string().nullable().optional(),
	refresh_token: z.string().nullable().optional(),
});

export const registrationPendingSchema = z.object({
	status: z.literal("pending"),
	username: z.string(),
});
export type RegistrationPending = z.infer<typeof registrationPendingSchema>;

/** Auth response shape returned by /auth/login, /auth/refresh, /auth/me */
export const authResponseSchema = meSchema;
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Register may return pending instead of a live user (non-first-user path → 202). */
export const registerResponseSchema = z.union([meSchema, registrationPendingSchema]);
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

// ── Registration Requests (admin queue) ────────────────────────────

export const registrationRequestSchema = z.object({
	id: z.number(),
	username: z.string(),
	display_name: z.string(),
	created_at: z.string().nullable(),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;

// ── Engine ─────────────────────────────────────────────────────────

export const engineCapabilitiesSchema = z.object({
	can_record: z.boolean().default(false),
	can_playlist: z.boolean().default(false),
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
	requester_user_token: z.string().optional(),
	engine_name: z.string().nullable().optional(),
	resolver_name: z.string().nullable().optional(),
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

const recordingProgressSchema = z.object({
	percent: z.number(),
	frame: z.number().optional(),
	current_time: z.number().optional(),
	total_duration: z.number().optional(),
	speed: z.number().optional(),
	elapsed: z.number().optional(),
	eta_seconds: z.number().nullable().optional(),
});

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
	engine_name: z.string().nullable().optional(),
	resolver_name: z.string().nullable().optional(),
	profile_name: z.string().nullable().optional(),
	recording_progress: recordingProgressSchema.optional(),
	session_folder: z.string().nullable().optional(),
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
	status: z
		.enum([
			"scheduled",
			"active",
			"recording",
			"terminating",
			"remuxing",
			"finalizing",
			"completed",
			"failed",
		])
		.default("scheduled"),
	start_time: z.string(),
	end_time: z.string(),
	recording: z.boolean(),
	requester_user_token: z.string().optional(),
	engine_name: z.string().nullable().optional(),
	resolver_name: z.string().nullable().optional(),
	profile_name: z.string().nullable().optional(),
	next_run_at: z.string().nullable().optional(),
	last_run_at: z.string().nullable().optional(),
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
	requester_user_token: z.string().optional(),
	session_id: z.number().nullable().optional(),
	media_served: z.boolean().optional(),
});

export type Recording = z.infer<typeof recordingSchema>;

// ── Notification ───────────────────────────────────────────────────

export const notificationSchema = z.object({
	id: z.number().optional(),
	resource_type: z.string(),
	resource_id: z.number(),
	event_type: z.string(),
	title: z.string(),
	body: z.string().optional(),
	read: z.boolean().optional(),
	created_at: z.string(),
});

export type Notification = z.infer<typeof notificationSchema>;

// ── Session Control ────────────────────────────────────────────────

export const controlResponseSchema = z.object({
	ok: z.literal(true),
	command: z.string(),
});

export type ControlResponse = z.infer<typeof controlResponseSchema>;

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

// ── Update Autorun (validated request body) ──────────────────────

export const updateAutorunSchema = z.object({
	user_friendly_name: z.string().min(1).optional(),
	snake_case_name: z
		.string()
		.regex(/^[a-zA-Z0-9_-]+$/)
		.optional(),
	profile_id: z.number().optional(),
	engine_id: z.number().optional(),
	resolver_id: z.number().optional(),
	resolver_config: z.record(z.string(), z.any()).optional(),
	retry_mode: z.string().optional(),
	retry_config: z.record(z.string(), z.any()).optional(),
	start_time: z.string().optional(),
	end_time: z.string().optional(),
	recording: z.boolean().optional(),
});

export type UpdateAutorunPayload = z.infer<typeof updateAutorunSchema>;

// ── Import/Export apply response ─────────────────────────────────

export const applyResponseSchema = z.object({
	profiles_created: z.number(),
	autoruns_created: z.number(),
	profiles_skipped: z.number(),
	created: z
		.object({
			profiles: z
				.array(z.object({ id: z.number(), name: z.string() }))
				.optional(),
			autoruns: z
				.array(z.object({ id: z.number(), name: z.string() }))
				.optional(),
		})
		.optional(),
	renamed: z.record(z.string(), z.string()).optional(),
});

export type ApplyResponse = z.infer<typeof applyResponseSchema>;

// ── Logs / progress / delete result ───────────────────────────────

export const deleteResultSchema = z.object({
	status: z.string().default("deleted"),
	deleted: z.record(z.string(), z.number()),
});

export type DeleteResult = z.infer<typeof deleteResultSchema>;

export const sessionLogsSchema = z.object({
	session_id: z.number(),
	stream: z.string(),
	name: z.string().default(""),
	lines: z.array(z.string()).default([]),
	next_offset: z.number().default(0),
	eof: z.boolean().default(true),
});

export type SessionLogs = z.infer<typeof sessionLogsSchema>;

export const recordingProgressResponseSchema = z.object({
	session_id: z.number(),
	progress: recordingProgressSchema.nullable().optional(),
	status: z.string().default(""),
});

export type RecordingProgressResponse = z.infer<typeof recordingProgressResponseSchema>;
