import { z } from "zod"

export const CapabilitiesSchema = z
  .object({
    can_stream: z.boolean().optional(),
    can_record: z.boolean().optional(),
  })
  .passthrough()

export type Capabilities = z.infer<typeof CapabilitiesSchema>

/** `EngineResponse` — lookup source for the name memo-map (limit=200 crawl). */
export const EngineSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    description: z.string().optional(),
    origin: z.string(),
    origin_hash: z.string(),
    capabilities: CapabilitiesSchema.optional(),
    retry_modes_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type Engine = z.infer<typeof EngineSchema>
