/**
 * Autorun payload shape.
 *
 * Contract: `docs/general-client-specification.md` §5 — `AutorunResponse` is
 * `{id, user_friendly_name, snake_case_name, profile_id?, engine_id,
 * resolver_id, resolver_config, retry_mode, retry_config, status, start_time,
 * end_time, recording, requester_user_token}` plus the enrichment the server
 * adds (`engine_name`, `resolver_name`, `profile_name`, `next_run_at`,
 * `last_run_at`). `status` is `scheduled` plus the session lifecycle enum.
 *
 * `passthrough` on purpose: optional enrichment must never break the client.
 */
import { z } from "zod"

export const autorunSchema = z
  .object({
    id: z.number().int(),
    user_friendly_name: z.string(),
    snake_case_name: z.string(),
    profile_id: z.number().int().nullable().optional(),
    engine_id: z.number().int(),
    resolver_id: z.number().int(),
    resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
    retry_mode: z.string().nullable().optional(),
    retry_config: z.record(z.string(), z.unknown()).nullable().optional(),
    status: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    recording: z.boolean().nullable().optional(),
    requester_user_token: z.string().nullable().optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
    next_run_at: z.string().nullable().optional(),
    last_run_at: z.string().nullable().optional(),
  })
  .passthrough()

export type Autorun = z.infer<typeof autorunSchema>
