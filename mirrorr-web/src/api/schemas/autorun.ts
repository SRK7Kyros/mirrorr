import { z } from "zod"
import { FallbackChainSchema } from "./fallback"
import { adminOnlyFields } from "./privileged"

/**
 * `AutorunResponse`. `start_time`/`end_time`/`next_run_at`/`last_run_at` are
 * naive UTC. `engine_name`/`resolver_name`/`profile_name`/`next_run_at`/
 * `last_run_at` are non-guaranteed → `.optional()`.
 */
export const AutorunSchema = z
  .object({
    id: z.number(),
    user_friendly_name: z.string(),
    snake_case_name: z.string(),
    profile_id: z.number().nullable().optional(),
    engine_id: z.number(),
    resolver_id: z.number(),
    resolver_config: z.record(z.string(), z.unknown()).optional(),
    retry_mode: z.string().optional(),
    retry_config: z.record(z.string(), z.unknown()).optional(),
    status: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    recording: z.boolean().optional(),
    orphan_policy: z.string().optional(),
    /** Why this schedule is blocked (`"profile-deleted"`); saving the form clears it. */
    issue: z.string().nullable().optional(),
    /** The chain after this run's own capture, as rungs (newest shape). */
    fallback_chain: FallbackChainSchema.optional(),
    fallback_profile_ids: z.array(z.number()).optional(),
    fallback_profile_names: z.array(z.string()).optional(),
    fallback_sources: z
      .array(
        z.object({
          resolver_id: z.number(),
          resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
        }),
      )
      .optional(),
    ...adminOnlyFields,
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
    next_run_at: z.string().nullable().optional(),
    last_run_at: z.string().nullable().optional(),
  })
  .passthrough()

export type Autorun = z.infer<typeof AutorunSchema>
