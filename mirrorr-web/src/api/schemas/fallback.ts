import { z } from "zod"

/**
 * One rung of a fallback chain — a patch over the capture before it.
 *
 * Every field is optional and nullable: a rung names only what it changes, and
 * the server fills the rest in (from the profile it names, else the rung above).
 */
export const FallbackRungSchema = z
  .object({
    profile_id: z.number().nullable().optional(),
    engine_id: z.number().nullable().optional(),
    resolver_id: z.number().nullable().optional(),
    resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()

export const FallbackChainSchema = z.array(FallbackRungSchema)

export type FallbackRungWire = z.infer<typeof FallbackRungSchema>
