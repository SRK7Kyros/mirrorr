/**
 * Auth endpoint layer.
 *
 * Contract: `docs/general-client-specification.md` §2 (exact paths, request
 * bodies, status codes) and `docs/web-frontend-spec.md` L409-L420 (endpoint
 * coverage). Login/register/status are public: they set `skipAuthRefresh` so a
 * 401 is a credential answer, never a session-expiry signal.
 */
import { apiFetch } from "@/lib/api"
import {
  authResponseSchema,
  authStatusSchema,
  type AuthResponse,
  type AuthStatus,
} from "@/lib/schemas/auth"

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiFetch("/auth/status", { schema: authStatusSchema, skipAuthRefresh: true })
}

export function fetchAuthMe(): Promise<AuthResponse> {
  return apiFetch("/auth/me", { schema: authResponseSchema })
}

export interface LoginInput {
  readonly username: string
  readonly password: string
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch("/auth/login", {
    method: "POST",
    body: { username: input.username, password: input.password },
    schema: authResponseSchema,
    skipAuthRefresh: true,
  })
}

export interface RegisterInput {
  readonly username: string
  readonly password: string
  readonly displayName?: string
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  const body: Record<string, string> = {
    username: input.username,
    password: input.password,
  }
  if (input.displayName !== undefined && input.displayName.length > 0) {
    body.display_name = input.displayName
  }

  return apiFetch("/auth/register", {
    method: "POST",
    body,
    schema: authResponseSchema,
    skipAuthRefresh: true,
  })
}

export function logout(): Promise<undefined> {
  return apiFetch("/auth/logout", { method: "POST", body: {} })
}

export interface ChangePasswordInput {
  readonly oldPassword: string
  readonly newPassword: string
}

export function changePassword(input: ChangePasswordInput): Promise<undefined> {
  return apiFetch("/auth/change-password", {
    method: "POST",
    body: { old_password: input.oldPassword, new_password: input.newPassword },
  })
}
