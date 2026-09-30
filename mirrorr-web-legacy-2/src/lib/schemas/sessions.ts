/**
 * Session payload shapes.
 *
 * Contract: `docs/general-client-specification.md` §4 — `SessionResponse` is
 * `{id, profile_id?, autorun_id?, engine_id, resolver_id, resolver_config,
 * retry_mode, retry_config, status, recording, retry_attempts, started_at?,
 * ended_at?, requester_user_token, session_urls[], attempts[]}` with the
 * lowercase status enum (`active | recording | terminating | remuxing |
 * finalizing | completed | failed`).
 *
 * The schemas are `passthrough` on purpose: the server may ship optional
 * enrichment fields (`engine_name`, `recording_progress`, `session_folder`)
 * without breaking an older client.
 */
import { z } from "zod"

/** One resolver-join / engine-start cycle (spec §4 "Attempts"). */
export const sessionAttemptSchema = z
  .object({
    index: z.number().int().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
    returncode: z.number().int().nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .passthrough()

export const sessionSchema = z
  .object({
    id: z.number().int(),
    profile_id: z.number().int().nullable().optional(),
    autorun_id: z.number().int().nullable().optional(),
    engine_id: z.number().int(),
    resolver_id: z.number().int(),
    resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
    retry_mode: z.string().nullable().optional(),
    retry_config: z.record(z.string(), z.unknown()).nullable().optional(),
    status: z.string(),
    recording: z.boolean().nullable().optional(),
    retry_attempts: z.number().int().nullable().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    requester_user_token: z.string().nullable().optional(),
    session_urls: z.array(z.record(z.string(), z.string())).nullable().optional(),
    attempts: z.array(sessionAttemptSchema).nullable().optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
  })
  .passthrough()

export type SessionAttempt = z.infer<typeof sessionAttemptSchema>
export type Session = z.infer<typeof sessionSchema>
