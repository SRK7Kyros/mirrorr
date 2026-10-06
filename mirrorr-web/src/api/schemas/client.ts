import { z } from "zod"

/** API-client identity from `AuthResponse.client` (admin CRUD returns the same shape). */
export const ClientSchema = z
  .object({
    id: z.number(),
    name: z.string(),
  })
  .passthrough()

export type Client = z.infer<typeof ClientSchema>
