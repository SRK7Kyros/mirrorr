import { z } from "zod"

/** `ResolverSourceResponse` — a saved `(resolver_id, resolver_config)` pair. */
export const ResolverSourceSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    resolver_id: z.number(),
    resolver_config: z.record(z.string(), z.unknown()).optional(),
    resolver_name: z.string().nullable().optional(),
  })
  .passthrough()

export type ResolverSource = z.infer<typeof ResolverSourceSchema>

/** One discovery result — `DiscoveryItemResponse`. */
export const DiscoveryItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    subtitle: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type DiscoveryItem = z.infer<typeof DiscoveryItemSchema>

/** `DiscoveryResponse` — `next_cursor` is opaque; absent or `null` ends the run. */
export const DiscoveryPageSchema = z
  .object({
    items: z.array(DiscoveryItemSchema).optional(),
    next_cursor: z.string().nullable().optional(),
  })
  .passthrough()

export type DiscoveryPage = z.infer<typeof DiscoveryPageSchema>
