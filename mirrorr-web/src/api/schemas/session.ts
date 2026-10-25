import { z } from "zod";
import { adminOnlyFields } from "./privileged";

/**
 * `SessionResponse`. Datetimes are naive UTC strings (never `Z`).
 * Non-guaranteed fields (contract §Zod validation) are `.optional()`:
 * `engine_name`, `resolver_name`, `profile_name`, `recording_progress`.
 */
export const SessionSchema = z
  .object({
    id: z.number(),
    profile_id: z.number().nullable().optional(),
    autorun_id: z.number().nullable().optional(),
    engine_id: z.number(),
    resolver_id: z.number(),
    resolver_config: z.record(z.string(), z.unknown()).optional(),
    retry_mode: z.string().optional(),
    retry_config: z.record(z.string(), z.unknown()).optional(),
    status: z.string(),
    recording: z.boolean().optional(),
    retry_attempts: z.number().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    ...adminOnlyFields,
    session_urls: z.array(z.record(z.string(), z.string())).optional(),
    attempts: z.array(z.record(z.string(), z.unknown())).optional(),
    captures: z.array(z.record(z.string(), z.unknown())).optional(),
    capture_plan: z
      .array(z.union([z.number(), z.record(z.string(), z.unknown())]).nullable())
      .optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
    autorun_name: z.string().nullable().optional(),
    recording_progress: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough();

export type Session = z.infer<typeof SessionSchema>;
