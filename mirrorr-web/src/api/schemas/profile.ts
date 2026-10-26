import { z } from "zod"
import { FallbackChainSchema } from "./fallback"

/** `ProfileResponse` — `engine_name`/`resolver_name` are non-guaranteed. */
export const ProfileSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    default_engine_id: z.number(),
    resolver_id: z.number(),
    resolver_config: z.record(z.string(), z.unknown()).optional(),
    /** The chain after this profile's own capture, as rungs (newest shape). */
    fallback_chain: FallbackChainSchema.optional(),
    fallback_sources: z
      .array(
        z.object({
          resolver_id: z.number(),
          resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
        }),
      )
      .optional(),
    retry_mode: z.string().optional(),
    retry_config: z.record(z.string(), z.unknown()).optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
  })
  .passthrough()

export type Profile = z.infer<typeof ProfileSchema>
