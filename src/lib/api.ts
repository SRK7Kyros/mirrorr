/**
 * API client for mirrorr-core backend.
 * Thin fetch wrapper with automatic auth header injection.
 */

import { useRequestLogStore } from "@/stores/request-log-store"
import type {
  Session,
  Autorun,
  Recording,
  Profile,
  Engine,
  Resolver,
  Notification,
  TelemetrySystem,
  ImportBundle,
  ValidationReport,
} from "@/lib/schemas"

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

// ── Auth failure callback (set by auth-store to avoid circular dep) ─

let _onAuthFailed: (() => void) | null = null

/** Called by auth-store to register a logout callback for refresh failures. */
export function onAuthFailed(cb: () => void) {
  _onAuthFailed = cb
}

// ── Token storage ──────────────────────────────────────────────────

const TOKEN_KEY = "mirrorr_jwt"
const REFRESH_KEY = "mirrorr_refresh_jwt"
const API_KEY_KEY = "mirrorr_api_key"

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function setStoredRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_KEY, token)
}

export function clearStoredRefreshToken(): void {
  localStorage.removeItem(REFRESH_KEY)
}

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_KEY)
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key)
}

// ── Core request function ──────────────────────────────────────────

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  /** Skip auth headers (for bootstrap endpoints). */
  noAuth?: boolean
}

async function _fetchJson<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, params, headers = {}, noAuth = false } = options

  const url = new URL(path, API_BASE)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const fetchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  }

  if (!noAuth) {
    const token = getStoredToken()
    if (token) {
      fetchHeaders["Authorization"] = `Bearer ${token}`
    }
    const apiKey = getStoredApiKey()
    if (apiKey) {
      fetchHeaders["X-API-Key"] = apiKey
    }
  }

  // Log the request
  const logEntry = {
    type: "http" as const,
    timestamp: Date.now(),
    method,
    url: url.toString(),
    path,
    status: null as number | null,
    statusText: "pending",
    duration: null as number | null,
    ok: null as boolean | null,
    error: null as string | null,
    requestBody: body ? (typeof body === "string" ? body : JSON.stringify(body)) : null,
    responseBody: null as string | null,
  }
  const logId = useRequestLogStore.getState().addEntry(logEntry)
  const startTime = Date.now()

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: fetchHeaders,
      body: body ? JSON.stringify(body) : undefined,
    })

    const duration = Date.now() - startTime
    let detail = res.statusText
    let responseBody: string | null = null

    if (!res.ok) {
      try {
        const errBody = await res.json()
        detail = errBody.detail ?? errBody.message ?? detail
        responseBody = JSON.stringify(errBody)
      } catch {
        // ignore parse error
      }
      useRequestLogStore.getState().updateEntry(logId, {
        status: res.status,
        statusText: detail,
        duration,
        ok: false,
        error: detail,
        responseBody,
      })
      throw new ApiError(res.status, detail)
    }

    // 204 No Content
    if (res.status === 204) {
      useRequestLogStore.getState().updateEntry(logId, {
        status: 204,
        statusText: "No Content",
        duration,
        ok: true,
      })
      return undefined as T
    }

    const data = await res.json() as T
    useRequestLogStore.getState().updateEntry(logId, {
      status: res.status,
      statusText: res.statusText,
      duration,
      ok: true,
      responseBody: JSON.stringify(data),
    })
    return data
  } catch (err) {
    const duration = Date.now() - startTime
    if (err instanceof ApiError) throw err
    useRequestLogStore.getState().updateEntry(logId, {
      status: 0,
      statusText: "Network Error",
      duration,
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    })
    throw err
  }
}

/** Core fetch with automatic 401 refresh-and-retry. */
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await _fetchJson<T>(path, options)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !options.noAuth) {
      const newToken = await refreshAccessToken()
      return await _fetchJson<T>(path, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
      })
    }
    throw err
  }
}

// ── Token refresh ────────────────────────────────────────────────

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getStoredRefreshToken()
    if (!refreshToken) throw new Error("No refresh token")

    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!res.ok) throw new Error("Refresh failed")

    const data = await res.json() as { access_token: string; refresh_token: string }
    setStoredToken(data.access_token)
    setStoredRefreshToken(data.refresh_token)
    return data.access_token
  })().catch((err) => {
    // Refresh failed — clear auth and notify the app
    clearStoredToken()
    clearStoredRefreshToken()
    _onAuthFailed?.()
    throw err
  }).finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

// ── Token expiry helpers ──────────────────────────────────────────

/** Parse a stored JWT and return its expiry timestamp, or null if unavailable. */
export function getTokenExpiry(): number | null {
  const token = getStoredToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split(".")[1]))
    return payload.exp
  } catch {
    return null
  }
}

/** Seconds remaining until the token expires, or 0 if unavailable. */
export function getTokenRemainingSeconds(): number {
  const exp = getTokenExpiry()
  if (!exp) return 0
  return Math.max(0, exp - Math.floor(Date.now() / 1000))
}

/** Whether the token is likely to expire within `withinSeconds`. */
export function tokenExpiringSoon(withinSeconds: number): boolean {
  return getTokenRemainingSeconds() < withinSeconds
}

/** Token status for UI indicators. */
export function tokenStatus(): "valid" | "expiring" | "expired" | "none" {
  const remaining = getTokenRemainingSeconds()
  if (remaining === 0 && !getStoredToken()) return "none"
  if (remaining <= 0) return "expired"
  if (remaining < 5 * 60) return "expiring"
  return "valid"
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

/** Start periodic token refresh. Refreshes every 13 minutes (tokens expire in 15). */
export function startTokenRefresh() {
  if (refreshInterval) return
  // Check every 60 seconds if token is expiring soon
  refreshInterval = setInterval(() => {
    if (tokenExpiringSoon(15 * 60)) {
      refreshAccessToken().catch(() => {}) // errors handled inside
    }
  }, 60_000)
  // Also do an immediate check on startup
  if (tokenExpiringSoon(10 * 60)) {
    refreshAccessToken().catch(() => {})
  }
}

export function stopTokenRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

// ── Auth API ───────────────────────────────────────────────────────

export const authApi = {
  status: () => apiRequest<{ has_users: boolean }>("/auth/status", { noAuth: true }),

  register: (data: { username: string; password: string; display_name?: string }) =>
    apiRequest<{
      user?: { id: number; username: string; role: string }
      access_token?: string
      message?: string
      request_id?: number
      status?: string
    }>("/auth/register", { method: "POST", body: data, noAuth: true }),

  login: (data: { username: string; password: string }) =>
    apiRequest<{
      user: { id: number; username: string; role: string }
      access_token: string
      refresh_token: string
    }>("/auth/login", { method: "POST", body: data }),

  me: () =>
    apiRequest<{
      user: { id: number; username: string; role: string; display_name: string }
      client: { id: number; name: string } | null
    }>("/auth/me"),

  changePassword: (data: { old_password: string; new_password: string }) =>
    apiRequest<{ status: string }>("/auth/change-password", { method: "POST", body: data }),

  // Admin
  users: () => apiRequest<Array<{ id: number; username: string; role: string; display_name: string }>>("/auth/users"),

  deleteUser: (username: string) =>
    apiRequest<{ status: string }>(`/auth/users/${username}`, { method: "DELETE" }),

  registrationRequests: (status?: string) =>
    apiRequest<Array<{ id: number; username: string; display_name: string; status: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null }>>(
      "/auth/registration-requests",
      { params: status ? { status } : undefined },
    ),

  approveRequest: (id: number) =>
    apiRequest<{ status: string; user: { id: number; username: string; role: string } }>(
      `/auth/registration-requests/${id}/approve`,
      { method: "POST" },
    ),

  denyRequest: (id: number) =>
    apiRequest<{ status: string }>(
      `/auth/registration-requests/${id}/deny`,
      { method: "POST" },
    ),
}

// ── Sessions API ───────────────────────────────────────────────────

export const sessionsApi = {
  list: () => apiRequest<Session[]>("/sessions/"),
  get: (id: number) => apiRequest<Session>(`/sessions/${id}`),
  create: (data: Record<string, unknown>) =>
    apiRequest<Session>("/sessions/", { method: "POST", body: data }),
  delete: (id: number) =>
    apiRequest<void>(`/sessions/${id}`, { method: "DELETE" }),
  stop: (id: number) =>
    apiRequest<Session>(`/sessions/${id}/stop`, { method: "POST" }),
  enableRecording: (id: number) =>
    apiRequest<Session>(`/sessions/${id}/recording/enable", { method: "POST" }),
  disableRecording: (id: number) =>
    apiRequest<Session>(`/sessions/${id}/recording/disable`, { method: "POST" }),
}

// ── Autoruns API ───────────────────────────────────────────────────

export const autorunsApi = {
  list: () => apiRequest<Autorun[]>("/autoruns/"),
  get: (id: number) => apiRequest<Autorun>(`/autoruns/${id}`),
  create: (data: Record<string, unknown>) =>
    apiRequest<Autorun>("/autoruns/", { method: "POST", body: data }),
  update: (id: number, data: Record<string, unknown>) =>
    apiRequest<Autorun>(`/autoruns/${id}`, { method: "PUT", body: data }),
  delete: (id: number) =>
    apiRequest<void>(`/autoruns/${id}`, { method: "DELETE" }),
}

// ── Recordings API ─────────────────────────────────────────────────

export const recordingsApi = {
  list: () => apiRequest<Recording[]>("/recordings/"),
  get: (id: number) => apiRequest<Recording>(`/recordings/${id}`),
  delete: (id: number) =>
    apiRequest<void>(`/recordings/${id}`, { method: "DELETE" }),
}

// ── Profiles API ───────────────────────────────────────────────────

export const profilesApi = {
  list: () => apiRequest<Profile[]>("/profiles/"),
  get: (id: number) => apiRequest<Profile>(`/profiles/${id}`),
  create: (data: Record<string, unknown>) =>
    apiRequest<Profile>("/profiles/", { method: "POST", body: data }),
  update: (id: number, data: Record<string, unknown>) =>
    apiRequest<Profile>(`/profiles/${id}`, { method: "PUT", body: data }),
  delete: (id: number) =>
    apiRequest<void>(`/profiles/${id}`, { method: "DELETE" }),
}

// ── Plugins API ────────────────────────────────────────────────────

export const pluginsApi = {
  engines: () => apiRequest<Engine[]>("/engines/"),
  engine: (id: number) => apiRequest<Engine>(`/engines/${id}`),
  resolvers: () => apiRequest<Resolver[]>("/resolvers/"),
  resolver: (id: number) => apiRequest<Resolver>(`/resolvers/${id}`),
}

// ── Import/Export API ─────────────────────────────────────────────

export const importExportApi = {
  validate: (bundle: Record<string, unknown>) =>
    apiRequest<ValidationReport>("/import-export/validate", { method: "POST", body: bundle }),
  apply: (bundle: Record<string, unknown>, pluginMap: Record<string, { type: string; id: number }>) =>
    apiRequest<{ profiles_created: number; autoruns_created: number; profiles_skipped: number }>("/import-export/apply", { method: "POST", body: { bundle, plugin_map: pluginMap } }),
  exportProfile: (id: number) =>
    apiRequest<ImportBundle>(`/import-export/profiles/${id}/export`),
  exportAutorun: (id: number) =>
    apiRequest<ImportBundle>(`/import-export/autoruns/${id}/export`),
}

// ── Notifications API ──────────────────────────────────────────────

export const notificationsApi = {
  list: () => apiRequest<Notification[]>("/notifications/"),
}

// ── Telemetry API ─────────────────────────────────────────────────

export const telemetryApi = {
  system: () => apiRequest<TelemetrySystem>("/telemetry/system"),
}

// ── WebSocket URLs ─────────────────────────────────────────────────

export function getWsEventsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws")
  const token = getStoredToken()
  const params = new URLSearchParams()
  if (token) params.set("token", token)
  return `${base}/ws/events?${params.toString()}`
}

export function getWsNotificationsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws")
  const token = getStoredToken()
  const params = new URLSearchParams()
  if (token) params.set("token", token)
  return `${base}/ws/notifications?${params.toString()}`
}
