/**
 * Auth response shapes.
 *
 * Contract: `docs/general-client-specification.md` §2 —
 * `{"user": {...}, "client": null}`; `access_token`/`refresh_token` are
 * optional fields the browser build ignores and the Capacitor wrapper reads
 * (`docs/web-frontend-spec.md` L116).
 */
import { z } from "zod"

export const authUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  role: z.string(),
  display_name: z.string().nullable().optional(),
})

export const authClientSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean().optional(),
})

export const authResponseSchema = z.object({
  user: authUserSchema,
  client: authClientSchema.nullable().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
})

export type AuthUser = z.infer<typeof authUserSchema>
export type AuthClient = z.infer<typeof authClientSchema>
export type AuthResponse = z.infer<typeof authResponseSchema>
