/**
 * Auth response shapes.
 *
 * Contract: `docs/general-client-specification.md` §2 —
 * `{"user": {...}, "client": null}`; `access_token`/`refresh_token` are
 * optional fields the browser build ignores and the Capacitor wrapper reads
 * (`docs/web-frontend-spec.md` L116).
 *
 * `user` is nullable because an API-key principal answers
 * `AuthState(client=..., user=None)` (§10.2, §13.10.1): the web client then
 * renders the API-client banner and suppresses the bell (spec L158, L647).
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
  created_at: z.string().nullable().optional(),
})

export const authResponseSchema = z.object({
  user: authUserSchema.nullable(),
  client: authClientSchema.nullable().optional(),
  access_token: z.string().nullable().optional(),
  refresh_token: z.string().nullable().optional(),
})

/** `POST /auth/register`: 200 `AuthResponse` for a live admin, 202 when the request goes to the pending queue. */
export const registrationPendingSchema = z.object({
  status: z.literal("pending"),
  username: z.string(),
})

/** V13's `GET /auth/clients` row (the server also returns `api_key_hash`, stripped here). */
export const apiClientSchema = authClientSchema

/** V13's `POST /auth/clients` envelope: `{"client": {...}, "api_key": "<plaintext>"}`. */
export const createdApiClientSchema = z.object({
  client: apiClientSchema,
  api_key: z.string(),
})

/**
 * `GET /auth/status` (public bootstrap probe, `docs/general-client-specification.md`
 * §2): drives the V2 route rule and the V1 footer hint.
 */
export const authStatusSchema = z.object({
  has_users: z.boolean(),
})

export type AuthUser = z.infer<typeof authUserSchema>
export type AuthClient = z.infer<typeof authClientSchema>
export type ApiClient = z.infer<typeof apiClientSchema>
export type CreatedApiClient = z.infer<typeof createdApiClientSchema>
export type RegistrationPending = z.infer<typeof registrationPendingSchema>
export type AuthResponse = z.infer<typeof authResponseSchema>
export type AuthStatus = z.infer<typeof authStatusSchema>
