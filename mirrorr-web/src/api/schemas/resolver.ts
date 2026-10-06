import { z } from "zod"

/** `ResolverResponse` — lookup source for the name memo-map (limit=200 crawl). */
export const ResolverSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    description: z.string().optional(),
    origin: z.string(),
    origin_hash: z.string(),
    config_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type Resolver = z.infer<typeof ResolverSchema>
