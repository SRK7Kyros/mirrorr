/**
 * The auth store: the single source of truth for the signed-in principal.
 *
 * Contract: `docs/web-frontend-spec.md` L53 (after logout a full cache wipe
 * then `/login`; after change-password a forced logout with toast), L156
 * (second 401 → wipe cache, `/login`, "Session expired") and L158 (`user.role`
 * comes from `["auth","me"]`; never a client-side ownership predicate).
 *
 * The store owns the forced-logout consequence; `api.ts` owns detecting it.
 */
import {
  markSessionRefreshed,
  resetSession,
  setForcedLogoutHandler,
  type ForcedLogoutReason,
} from "@/lib/api"
import { changePassword as postChangePassword, logout as postLogout } from "@/lib/auth"
import { queryKeys } from "@/lib/query-keys"
import type { AuthClient, AuthResponse, AuthUser } from "@/lib/schemas/auth"
import { clearToasts, showToast } from "@/lib/toast"
import { queryClient } from "@/query-client"

export const SESSION_EXPIRED_MESSAGE = "Session expired"
export const PASSWORD_CHANGED_MESSAGE = "Password changed — sign in again"
export const RATE_LIMITED_MESSAGE = "Too many attempts — try again shortly"
export const LOGIN_FAILED_MESSAGE = "Invalid username or password"
export const API_UNREACHABLE_MESSAGE = "API unreachable"

export interface AuthState {
  readonly user: AuthUser | null
  readonly client: AuthClient | null
  readonly sessionExpired: boolean
}

const ANONYMOUS: AuthState = { user: null, client: null, sessionExpired: false }

let state: AuthState = ANONYMOUS
let navigateToLogin: ((redirectPath: string) => void) | null = null
let getCurrentHref: (() => string) | null = null
const listeners = new Set<() => void>()

function setState(next: AuthState): void {
  state = next
  for (const listener of listeners) listener()
}

export function getAuthState(): AuthState {
  return state
}

export function subscribeToAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAuthSession(response: AuthResponse): void {
  setState({ user: response.user, client: response.client ?? null, sessionExpired: false })
}

export function clearAuthSession(): void {
  setState(ANONYMOUS)
}

export function markSessionExpired(): void {
  setState({ user: null, client: null, sessionExpired: true })
}

/** One-shot read used by the root layout to raise the spec toast. */
export function consumeSessionExpired(): boolean {
  if (!state.sessionExpired) return false
  setState(ANONYMOUS)
  return true
}

export interface AuthSessionWiring {
  readonly navigateToLogin: (redirectPath: string) => void
  readonly getCurrentHref: () => string
}

/** Called once at boot (and by tests with their own router). */
export function installAuthSession(wiring: AuthSessionWiring): void {
  navigateToLogin = wiring.navigateToLogin
  getCurrentHref = wiring.getCurrentHref
  setForcedLogoutHandler(handleForcedLogout)
}

function handleForcedLogout(_reason: ForcedLogoutReason): void {
  const hadSession = state.user !== null || state.client !== null
  queryClient.clear()
  clearToasts()
  if (hadSession) markSessionExpired()
  else setState(ANONYMOUS)
  redirectToLogin()
}

function redirectToLogin(): void {
  navigateToLogin?.(getCurrentHref?.() ?? "/")
}

/** Full logout flow (spec L53): cache wipe first, then `/login`. */
export function clearSession(): void {
  queryClient.clear()
  clearAuthSession()
  resetSession()
  redirectToLogin()
}

export async function signOut(): Promise<void> {
  try {
    await postLogout()
  } catch {
    // Server-side revoke is best-effort; the local wipe is authoritative.
  }
  clearSession()
}

/**
 * Change-password rule (spec L53, L371): a 200 means the server invalidated
 * every access token, so the client force-signs out with the spec toast. The
 * V11 form arrives in todo 16 — the rule lives here so it cannot drift.
 */
export async function changePasswordAndSignOut(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  await postChangePassword({ oldPassword, newPassword })
  clearSession()
  showToast(PASSWORD_CHANGED_MESSAGE, "info")
}

/** Seeds every cache/store location a login/register response feeds. */
export function completeAuthentication(response: AuthResponse): void {
  markSessionRefreshed()
  setAuthSession(response)
  queryClient.setQueryData(queryKeys.authMe(), response)
}
