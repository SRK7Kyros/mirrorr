/**
 * The JSON-Schema subset the dynamic forms understand.
 *
 * Contract: `docs/web-frontend-spec.md` L403 (`DynamicSchemaForm` renders
 * `string`/`number`/`integer`/`boolean`/`enum`/array-of-integers/nested
 * `object`) and L254-L280 of `docs/general-client-specification.md` (engine
 * `retry_modes_schema` and resolver `config_schema` are JSON Schema objects).
 *
 * The server emits full pydantic schemas; this module parses them loosely
 * (`passthrough`) so a server-side schema enrichment never breaks the client.
 */
import { z } from "zod"

export const jsonSchemaSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    items: z.unknown().optional(),
    additionalProperties: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .passthrough()

export type JsonSchema = z.infer<typeof jsonSchemaSchema>

/** Coerces any raw schema node into a `JsonSchema`; invalid nodes become `{}`. */
export function readJsonSchema(value: unknown): JsonSchema {
  const parsed = jsonSchemaSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

/** True for `{type:"object", ...}` and object-shaped schemas without a type. */
export function isObjectSchema(schema: JsonSchema): boolean {
  return schema.type === "object" || (!schema.type && schema.properties !== undefined)
}
