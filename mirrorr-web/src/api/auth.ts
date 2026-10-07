import {
  ApiError,
  apiFetch,
  resetAuthExhausted,
  setAuthExhaustedHandler,
  startProactiveRefresh,
  stopProactiveRefresh,
} from "@/api/client"
import { disposeEventTable, installEventTable } from "@/api/realtime/event-table"
import { startRealtimeManager, stopRealtimeManager } from "@/api/realtime/manager"
import {
  AuthResponseSchema,
  RegistrationPendingSchema,
  type AuthResponse,
  type RegistrationPending,
} from "@/api/schemas"
import { queryClient } from "@/api/query-client"

export type AuthStatus = "unknown" | "authenticated" | "anonymous"

export interface AuthState {
  readonly status: AuthStatus
  readonly auth: AuthResponse | null
}

let state: AuthState = { status: "unknown", auth: null }
const listeners = new Set<() => void>()

export function getAuthState(): AuthState {
  return state
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(next: AuthState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Scaffold-compatible guard check backed by the session state. */
export function isAuthenticated(): boolean {
  return state.status === "authenticated"
}

export function currentAuth(): AuthResponse | null {
  return state.auth
}

/**
 * API-client principal (`client` set, `user` null): views hide the bell,
 * show the persistent banner, and force the 10s polling cadence via
 * polling-policy; the top bar shows API_CLIENT_POLL_LABEL, never the WS dot.
 */
export function isApiClientPrincipal(auth: AuthResponse | null = state.auth): boolean {
  return auth !== null && auth.client != null && auth.user == null
}

export function apiClientBannerText(clientName: string): string {
  return `Acting as API client '${clientName}' — created resources belong to no user and produce no notifications`
}

export const API_CLIENT_POLL_LABEL = "API client — polling every 10s"

function onAuthenticated(auth: AuthResponse): void {
  setState({ status: "authenticated", auth })
  queryClient.setQueryData(["auth", "me"], auth)
  startRealtimeManager({ openNotifications: auth.user != null })
  startProactiveRefresh()
  installEventTable()
}

function clearSession(): void {
  stopRealtimeManager()
  stopProactiveRefresh()
  disposeEventTable()
  queryClient.clear()
  setState({ status: "anonymous", auth: null })
}

/**
 * Boot/guard flow: resolves on a session (fetching `GET /auth/me` on first
 * use); 401 → anonymous + throw so the route guard redirects to /login.
 * First success opens the realtime manager.
 */
export async function ensureAuthMe(): Promise<AuthResponse> {
  if (state.status === "authenticated" && state.auth !== null) return state.auth
  try {
    const raw = await apiFetch<unknown>("/auth/me")
    const auth = AuthResponseSchema.parse(raw)
    onAuthenticated(auth)
    return auth
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (state.status !== "anonymous") setState({ status: "anonymous", auth: null })
      throw error
    }
    if (error instanceof Error && error.name === "ZodError") {
      console.warn("auth/me response failed schema validation", error)
    }
    throw error
  }
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const raw = await apiFetch<unknown>("/auth/login", {
    method: "POST",
    body: { username, password },
    skipAuthRefresh: true,
  })
  const auth = AuthResponseSchema.parse(raw)
  resetAuthExhausted()
  onAuthenticated(auth)
  return auth
}

function isPendingRegistration(raw: unknown): boolean {
  return raw !== null && typeof raw === "object" && (raw as { status?: unknown }).status === "pending"
}

export async function register(
  username: string,
  password: string,
  displayName = "",
): Promise<AuthResponse | RegistrationPending> {
  const raw = await apiFetch<unknown>("/auth/register", {
    method: "POST",
    body: { username, password, display_name: displayName },
    skipAuthRefresh: true,
  })
  if (isPendingRegistration(raw)) return RegistrationPendingSchema.parse(raw)
  const auth = AuthResponseSchema.parse(raw)
  resetAuthExhausted()
  onAuthenticated(auth)
  return auth
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST", skipAuthRefresh: true })
  } catch {
    // Best-effort server logout — the local clear below is authoritative.
  }
  clearSession()
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: { old_password: oldPassword, new_password: newPassword },
    skipAuthRefresh: true,
  })
  // 200 → server revoked every token → forced logout flow.
  await forceLogout()
}

/**
 * Forced logout (401 exhaustion seam, change-password, failed WS-4001
 * refresh): wipe cache + close realtime. Navigation happens only when a
 * session existed, so anonymous boot failures never bounce public pages.
 */
/**
 * Navigation seam. The API layer must not depend on the router, so the UI
 * injects how to reach the login screen. Without a navigator we fall back to a
 * hard location change.
 */
export interface AuthNavigator {
  readonly toLogin: () => void
}

let navigator: AuthNavigator | null = null

export function setAuthNavigator(next: AuthNavigator | null): void {
  navigator = next
}

export async function forceLogout(): Promise<void> {
  const wasAuthenticated = state.status === "authenticated"
  clearSession()
  if (!wasAuthenticated) return
  try {
    navigator?.toLogin()
  } catch {
    window.location.assign("/login")
  }
}

setAuthExhaustedHandler(() => {
  void forceLogout()
})

/** Accept only same-origin absolute paths — never protocol-relative "//evil". */
export function sanitizeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (!value.startsWith("/") || value.startsWith("//")) return null
  return value
}
