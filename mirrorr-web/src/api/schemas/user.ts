import { z } from "zod"

/** `AuthResponse.user` — only these four fields are client-readable. */
export const UserSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    role: z.string(),
    display_name: z.string(),
  })
  .passthrough()

export type User = z.infer<typeof UserSchema>
