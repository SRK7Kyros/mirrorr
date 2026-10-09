import { getApiUrl } from "@/api/config"

/** Base URL without trailing slash — server runs `redirect_slashes=False`. */
export function apiBase(): string {
  const base = getApiUrl()
  return base.endsWith("/") ? base.slice(0, -1) : base
}

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors?: Readonly<Record<string, string>>

  constructor(status: number, detail: string, fieldErrors?: Readonly<Record<string, string>>) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    if (fieldErrors !== undefined) this.fieldErrors = fieldErrors
  }
}

export interface ApiFetchInit {
  readonly method?: string
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  /** 401 is a semantic answer here (bad credentials) — skip refresh/retry. */
  readonly skipAuthRefresh?: boolean
  /** Internal: marks the single retry after a successful refresh. */
  readonly isRetry?: boolean
}

const FORM_LOC_FIELDS = new Set(["body", "query", "path", "header", "cookie"])

/** FastAPI 422 `detail: [{loc, msg}]` → `{field: msg}`; `["body"]` alone → `_form`. */
function fieldErrorsFrom422(detail: readonly unknown[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const entry of detail) {
    if (entry === null || typeof entry !== "object") continue
    const record = entry as { loc?: unknown; msg?: unknown }
    const loc = Array.isArray(record.loc)
      ? record.loc.filter((part): part is string => typeof part === "string")
      : []
    const last = loc.at(-1)
    const field = last === undefined || FORM_LOC_FIELDS.has(last) ? "_form" : last
    const msg = typeof record.msg === "string" ? record.msg : "Invalid value"
    errors[field] = errors[field] === undefined ? msg : `${errors[field]}; ${msg}`
  }
  return errors
}

/** Custom `{detail, errors}` shape → `{field: string}` (arrays joined). */
function fieldErrorsFromCustom(errors: unknown): Record<string, string> | undefined {
  if (errors === null || typeof errors !== "object" || Array.isArray(errors)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value
    else if (Array.isArray(value)) {
      const joined = value.filter((item): item is string => typeof item === "string").join("; ")
      if (joined !== "") out[key] = joined
    } else if (value !== null && value !== undefined) out[key] = String(value)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function defaultMessage(status: number): string {
  if (status === 401) return "Not authenticated"
  if (status === 403) return "Forbidden"
  if (status === 404) return "Not found"
  if (status === 409) return "Conflict"
  if (status === 429) return "Too many attempts — try again shortly"
  if (status >= 500) return "Server error"
  return `Request failed (${status})`
}

function joinDetailMessages(detail: readonly unknown[]): string {
  const messages: string[] = []
  for (const entry of detail) {
    if (entry === null || typeof entry !== "object") continue
    const record = entry as { loc?: unknown; msg?: unknown }
    if (typeof record.msg !== "string") continue
    const loc = Array.isArray(record.loc)
      ? record.loc.filter((part): part is string => typeof part === "string")
      : []
    const field = loc.filter((part) => !FORM_LOC_FIELDS.has(part)).at(-1)
    messages.push(field === undefined ? record.msg : `${field}: ${record.msg}`)
  }
  return messages.join("; ")
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null // non-JSON error body → status default below
  }

  if (Array.isArray(body)) {
    const detail = joinDetailMessages(body)
    return new ApiError(
      response.status,
      detail === "" ? defaultMessage(response.status) : detail,
      fieldErrorsFrom422(body),
    )
  }

  if (body !== null && typeof body === "object") {
    const record = body as Record<string, unknown>
    let detail: string
    if (typeof record.detail === "string") {
      detail = record.detail
    } else if (Array.isArray(record.detail)) {
      const joined = joinDetailMessages(record.detail)
      detail = joined === "" ? defaultMessage(response.status) : joined
    } else {
      detail = defaultMessage(response.status)
    }
    const fieldErrors =
      Array.isArray(record.detail) && record.detail.length > 0
        ? fieldErrorsFrom422(record.detail)
        : fieldErrorsFromCustom(record.errors)
    return fieldErrors === undefined
      ? new ApiError(response.status, detail)
      : new ApiError(response.status, detail, fieldErrors)
  }

  return new ApiError(response.status, defaultMessage(response.status))
}

let authExhaustedHandler: (() => void) | null = null
let authExhaustedLatched = false
let refreshInFlight: Promise<void> | null = null
let lastRefreshAt = Date.now()

/** Forced-logout seam — registered by `lib/auth.ts`. */
export function setAuthExhaustedHandler(handler: (() => void) | null): void {
  authExhaustedHandler = handler
}

/** Re-arm after a successful login/refresh so the next expiry can fire once. */
export function resetAuthExhausted(): void {
  authExhaustedLatched = false
}

export function lastAuthRefreshAt(): number {
  return lastRefreshAt
}

function notifyAuthExhausted(): void {
  if (authExhaustedLatched) return
  authExhaustedLatched = true
  authExhaustedHandler?.()
}

/**
 * Single-flight refresh: concurrent 401s from parallel queries await one
 * shared `POST /auth/refresh`, so refresh-token rotation (JTI) cannot race.
 * A refresh 401 rejects that shared promise once → all waiters fail → one
 * logout, never a retry storm.
 */
export function refreshSession(): Promise<void> {
  if (refreshInFlight === null) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function performRefresh(): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
  } catch (error) {
    // Network failure ≠ expired session: fail the waiters, no logout.
    throw new ApiError(0, error instanceof Error ? error.message : "Network error during refresh")
  }
  if (response.ok || response.status === 204) {
    lastRefreshAt = Date.now()
    resetAuthExhausted()
    return
  }
  const error = await toApiError(response)
  if (error.status === 401) notifyAuthExhausted()
  throw error
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  for (const [key, value] of Object.entries(init.headers ?? {})) headers[key] = value
  const hasBody = init.body !== undefined
  if (hasBody) headers["Content-Type"] = "application/json"
  const method = init.method ?? (hasBody ? "POST" : "GET")

  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      credentials: "include",
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    throw new ApiError(0, error instanceof Error ? error.message : "Network error")
  }

  if (response.status === 401 && init.skipAuthRefresh !== true) {
    if (init.isRetry === true) {
      // Second 401 after a successful refresh — one logout, no retry storm.
      notifyAuthExhausted()
    } else {
      await refreshSession()
      return apiFetch<T>(path, { ...init, isRetry: true })
    }
  }

  if (!response.ok) throw await toApiError(response)
  if (response.status === 204 || response.status === 205) return undefined as T

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(response.status, "Unexpected server response")
  }
}

const PROACTIVE_REFRESH_MS = 23 * 60 * 60 * 1000
const VISIBILITY_REFRESH_AFTER_MS = 60 * 60 * 1000
let proactiveTimer: ReturnType<typeof setTimeout> | null = null
let proactiveInstalled = false

function scheduleProactiveRefresh(): void {
  proactiveTimer = setTimeout(() => {
    proactiveTimer = null
    refreshSession().then(scheduleProactiveRefresh, () => {
      proactiveTimer = null // failure already routed through the auth-exhausted seam
    })
  }, PROACTIVE_REFRESH_MS)
}

function handleVisibilityRefresh(): void {
  if (document.visibilityState !== "visible") return
  if (Date.now() - lastRefreshAt < VISIBILITY_REFRESH_AFTER_MS) return
  void refreshSession().catch((error: unknown) => {
    console.warn("Proactive auth refresh failed", error)
  })
}

/** 23h uptime timer + `visibilitychange` refresh when last refresh >1h ago. */
export function startProactiveRefresh(): void {
  if (proactiveInstalled) return
  proactiveInstalled = true
  scheduleProactiveRefresh()
  document.addEventListener("visibilitychange", handleVisibilityRefresh)
}

export function stopProactiveRefresh(): void {
  if (!proactiveInstalled) return
  proactiveInstalled = false
  if (proactiveTimer !== null) {
    clearTimeout(proactiveTimer)
    proactiveTimer = null
  }
  document.removeEventListener("visibilitychange", handleVisibilityRefresh)
}
