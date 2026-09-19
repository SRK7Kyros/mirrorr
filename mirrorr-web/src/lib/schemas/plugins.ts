/**
 * Engine, resolver and profile payload shapes.
 *
 * Contract: `docs/general-client-specification.md` §3 (ProfileResponse), §8
 * (EngineResponse with `capabilities.can_record` + `retry_modes_schema`;
 * ResolverResponse with `config_schema`) and `docs/web-frontend-spec.md`
 * L254-L265/L401 (D1 consumes all three).
 */
import { z } from "zod"
import { jsonSchemaSchema } from "@/lib/schemas/json-schema"

/**
 * One `retry_modes_schema` entry: the mode's JSON Schema plus the defaults the
 * form prefills (spec L255: `{ "<mode>": { schema, default_params } }`).
 */
export const retryModeEntrySchema = z
  .object({
    schema: jsonSchemaSchema.optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    retryable_exit_codes: z.array(z.number().int()).nullable().optional(),
  })
  .passthrough()

export const engineCapabilitiesSchema = z
  .object({
    can_record: z.boolean().optional(),
    can_playlist: z.boolean().optional(),
  })
  .passthrough()

export const engineSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().optional(),
    origin: z.string().optional(),
    origin_hash: z.string().optional(),
    capabilities: engineCapabilitiesSchema.optional(),
    retry_modes_schema: z.record(z.string(), retryModeEntrySchema).optional(),
  })
  .passthrough()

export const resolverSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().optional(),
    origin: z.string().optional(),
    origin_hash: z.string().optional(),
    config_schema: jsonSchemaSchema.optional(),
  })
  .passthrough()

export const profileSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    default_engine_id: z.number().int(),
    resolver_id: z.number().int(),
    resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
    retry_mode: z.string().nullable().optional(),
    retry_config: z.record(z.string(), z.unknown()).nullable().optional(),
    requester_user_token: z.string().nullable().optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
  })
  .passthrough()

export type RetryModeEntry = z.infer<typeof retryModeEntrySchema>
export type Engine = z.infer<typeof engineSchema>
export type Resolver = z.infer<typeof resolverSchema>
export type Profile = z.infer<typeof profileSchema>

/** Engine capability gate (spec L217): only an explicit `false` disables. */
export function engineCanRecord(engine: Engine | null | undefined): boolean {
  return engine?.capabilities?.can_record !== false
}
