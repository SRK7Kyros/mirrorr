import { z } from "zod"
import { ClientSchema } from "./client"
import { UserSchema } from "./user"

/**
 * `GET /auth/me`, `POST /auth/login|register|refresh`.
 *
 * - `user`/`client` are nullable: an API-client principal has `client` set
 *   and `user` null (Data Layer Contract §Role/owner gating).
 * - `access_token`/`refresh_token` are nullish (null on cookie-only builds,
 *   string on Capacitor) — `.optional()` alone rejects explicit `null`.
 */
export const AuthResponseSchema = z
  .object({
    user: UserSchema.nullable().optional(),
    client: ClientSchema.nullable().optional(),
    access_token: z.string().nullish(),
    refresh_token: z.string().nullish(),
  })
  .passthrough()

export type AuthResponse = z.infer<typeof AuthResponseSchema>

/** `POST /auth/register` bootstrap result when registration is approval-gated. */
export const RegistrationPendingSchema = z
  .object({
    status: z.literal("pending"),
    username: z.string(),
  })
  .passthrough()

export type RegistrationPending = z.infer<typeof RegistrationPendingSchema>

/** Register accepts either shape — pending must be tried first (passthrough would swallow it). */
export const RegisterResponseSchema = z.union([
  RegistrationPendingSchema,
  AuthResponseSchema,
])

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>

/** `GET /auth/status` — drives the register link and login throttling UI. */
export const AuthStatusSchema = z
  .object({
    has_users: z.boolean(),
  })
  .passthrough()

export type AuthStatus = z.infer<typeof AuthStatusSchema>
