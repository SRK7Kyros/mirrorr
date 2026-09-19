/**
 * Route-guard primitives for the two-branch tree.
 *
 * Contract: `docs/web-frontend-spec.md` L29-L31 (guard structure and redirect
 * semantics), L150-L156 (refresh-once flow), L158 (admin gating reads
 * `user.role` from `["auth","me"]`).
 */
import { redirect } from "@tanstack/react-router"
import { fetchAuthMe, fetchAuthStatus } from "@/lib/auth"
import { getAuthState, setAuthSession } from "@/lib/auth-store"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import type { AuthResponse, AuthStatus } from "@/lib/schemas/auth"
import { queryClient } from "@/query-client"

export const AUTH_STATUS_STALE_TIME_MS = 30_000

/**
 * Authenticated-branch entry: cached `["auth","me"]` when fresh (60s), else one
 * `GET /auth/me`. The 401 → refresh → retry dance lives inside `apiFetch`, so
 * this never loops; failures reject for the caller to redirect on.
 */
export async function ensureAuthMe(): Promise<AuthResponse> {
  const me = await queryClient.ensureQueryData({
    queryKey: queryKeys.authMe(),
    queryFn: fetchAuthMe,
    staleTime: QUERY_STALE_TIMES_MS.authMe,
    retry: false,
  })
  setAuthSession(me)
  return me
}

export function readCachedAuthMe(): AuthResponse | null {
  return queryClient.getQueryData<AuthResponse>(queryKeys.authMe()) ?? null
}

/** Public-branch soft check (spec L31): cache OR the store already knows a user. */
export function isAuthenticated(): boolean {
  return getAuthState().user !== null || readCachedAuthMe() !== null
}

export async function ensureAuthStatus(): Promise<AuthStatus> {
  return queryClient.ensureQueryData({
    queryKey: queryKeys.authStatus(),
    queryFn: fetchAuthStatus,
    staleTime: AUTH_STATUS_STALE_TIME_MS,
    retry: false,
  })
}

/** Admin surfaces are hidden/blocked for `role !== "admin"` (spec L158). */
export function requireAdmin(): void {
  if (getAuthState().user?.role !== "admin") {
    throw redirect({ to: "/settings" })
  }
}

export function redirectToLogin(location: { readonly href: string }): never {
  throw redirect({ to: "/login", search: { redirect: location.href } })
}
