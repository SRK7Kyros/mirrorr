import { z } from "zod"

// ── Auth ───────────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(4, "Password must be at least 4 characters"),
})

export const registerSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(4, "Password must be at least 4 characters"),
  display_name: z.string().optional(),
})

export const changePasswordSchema = z.object({
  old_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(4, "Password must be at least 4 characters"),
  confirm_password: z.string().min(4, "Password must be at least 4 characters"),
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
})

// ── User ───────────────────────────────────────────────────────────

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  role: z.enum(["admin", "user"]),
  display_name: z.string(),
  created_at: z.string().optional(),
})

export type User = z.infer<typeof userSchema>

// ── Auth Status ────────────────────────────────────────────────────

export const authStatusSchema = z.object({
  has_users: z.boolean(),
})

export const meSchema = z.object({
  user: userSchema,
  client: z.object({ id: z.number(), name: z.string() }).nullable(),
})

// ── Registration Request ───────────────────────────────────────────

export const registrationRequestSchema = z.object({
  id: z.number(),
  username: z.string(),
  display_name: z.string(),
  status: z.enum(["pending", "approved", "denied"]),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
})

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>

// ── Engine ─────────────────────────────────────────────────────────

export const engineCapabilitiesSchema = z.object({
  can_record: z.boolean(),
  can_playlist: z.boolean(),
})

export const engineSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  origin: z.string(),
  origin_hash: z.string(),
  capabilities: engineCapabilitiesSchema,
  retry_modes_schema: z.record(z.string(), z.any()),
})

export type Engine = z.infer<typeof engineSchema>

// ── Resolver ───────────────────────────────────────────────────────

export const resolverSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  origin: z.string(),
  origin_hash: z.string(),
  config_schema: z.record(z.any()),
})

export type Resolver = z.infer<typeof resolverSchema>

// ── Profile ────────────────────────────────────────────────────────

export const profileSchema = z.object({
  id: z.number(),
  name: z.string(),
  default_engine_id: z.number(),
  resolver_id: z.number(),
  resolver_config: z.record(z.any()),
  retry_mode: z.string(),
  retry_config: z.record(z.any()),
  requester_user_token: z.string(),
})

export type Profile = z.infer<typeof profileSchema>

export const createProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  default_engine_id: z.number({ required_error: "Engine is required" }),
  resolver_id: z.number({ required_error: "Resolver is required" }),
  resolver_config: z.record(z.any()).default({}),
  retry_mode: z.string().default("none"),
  retry_config: z.record(z.any()).default({}),
})

// ── Session ────────────────────────────────────────────────────────

export const sessionStatusSchema = z.enum([
  "active",
  "recording",
  "remuxing",
  "completed",
  "failed",
])

export const sessionSchema = z.object({
  id: z.number(),
  profile_id: z.number(),
  autorun_id: z.number().nullable(),
  engine_id: z.number(),
  status: sessionStatusSchema,
  recording: z.boolean(),
  retry_mode_override: z.string().nullable(),
  retry_config_override: z.record(z.any()).nullable(),
  retry_attempts: z.number(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  requester_user_token: z.string(),
  session_urls: z.array(z.record(z.string())),
})

export type Session = z.infer<typeof sessionSchema>

export const createSessionSchema = z.object({
  profile_id: z.number({ required_error: "Profile is required" }),
  engine_id: z.number({ required_error: "Engine is required" }),
  recording: z.boolean().default(false),
  retry_mode_override: z.string().optional(),
  retry_config_override: z.record(z.any()).optional(),
})

// ── Autorun ────────────────────────────────────────────────────────

export const autorunSchema = z.object({
  id: z.number(),
  user_friendly_name: z.string(),
  snake_case_name: z.string(),
  profile_id: z.number(),
  engine_id: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  recording: z.boolean(),
  retry_mode_override: z.string().nullable(),
  retry_config_override: z.record(z.any()).nullable(),
  requester_user_token: z.string(),
})

export type Autorun = z.infer<typeof autorunSchema>

export const createAutorunSchema = z.object({
  user_friendly_name: z.string().min(1, "Name is required"),
  snake_case_name: z.string().min(1, "Slug is required"),
  profile_id: z.number({ required_error: "Profile is required" }),
  engine_id: z.number({ required_error: "Engine is required" }),
  start_time: z.string().min(1, "Start time is required"),
  end_time: z.string().min(1, "End time is required"),
  recording: z.boolean().default(true),
  retry_mode_override: z.string().nullable().default(null),
  retry_config_override: z.record(z.any()).nullable().default(null),
})

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
  requester_user_token: z.string(),
})

export type Recording = z.infer<typeof recordingSchema>

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
})

export type Notification = z.infer<typeof notificationSchema>
