/**
 * The single HTTP entry point for the app.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L114-L116 (client shape, `credentials`,
 *   exact paths, `ApiError`, 204 handling, Zod parse policy) and L150-L156
 *   (single-flight refresh, proactive refresh, forced logout).
 * - `docs/general-client-specification.md` §1 (transport/errors/pagination),
 *   §2 (auth), §13.1 (session-expiry dance), §13.9.4-§13.9.7.
 *
 * Invariants owned here:
 * - The path is appended to the configured base VERBATIM — no trailing slash
 *   is ever added or removed (the server runs `redirect_slashes=False`).
 * - Cookie mode sends `credentials: "include"` and never reads
 *   `document.cookie`; bearer mode is the Capacitor seam (§Mobile Auth) and
 *   sends `Authorization: Bearer <jwt>` with `credentials: "omit"`.
 * - 204 returns `undefined` and is never parsed.
 * - Non-2xx throws a discriminated `ApiError`; 422 payloads map to
 *   per-field messages.
 * - 401 → one shared `POST /auth/refresh` → retry once → forced logout. A
 *   failed refresh is never retried and never loops.
 * - A schema mismatch warns and refetches at most once, then throws
 *   `ApiParseError` (rendered as "Unexpected server response").
 * - `apiFetchText` runs the same request core for downloads (`GET
 *   /import-export/.../export`): same auth/credentials/refresh semantics, body
 *   returned as text for the caller to validate and save.
 */
import type { ZodError, ZodType } from "zod"
import { getApiBaseUrl } from "@/config/env"
import { ApiError, ApiParseError } from "@/lib/errors"
import { authResponseSchema, type AuthResponse } from "@/lib/schemas/auth"
import { detailFromEnvelope, fieldErrorsFromEnvelope } from "@/lib/schemas/error-payload"

const UNAUTHORIZED = 401
const UNPROCESSABLE_ENTITY = 422
const NO_CONTENT = 204
const RESET_CONTENT = 205

/** The one endpoint this module calls by itself (auth flows). */
const REFRESH_PATH = "/auth/refresh"

/** Proactive refresh cadence: 23h of uptime (access token TTL is 24h). */
export const PROACTIVE_REFRESH_INTERVAL_MS = 23 * 60 * 60 * 1000

/** Proactive refresh only fires when the last successful refresh is older. */
export const MIN_REFRESH_AGE_MS = 60 * 60 * 1000

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

interface RequestOptions {
  readonly method?: HttpMethod
  readonly body?: unknown
  readonly signal?: AbortSignal
  readonly headers?: Readonly<Record<string, string>>
  /**
   * Public endpoints (login/register/status) where a 401 means "bad
   * credentials / not bootstrapped", not "expired session": the
   * refresh-and-retry dance is skipped and the 401 is surfaced as-is.
   */
  readonly skipAuthRefresh?: boolean
}

export interface ApiFetchOptions<T> extends RequestOptions {
  /**
   * Schema the 2xx body must match. With a schema the result is typed `T`; a
   * mismatch warns and refetches once before `ApiParseError` is thrown.
   * Without a schema the call is side-effect-only and resolves `undefined`.
   */
  readonly schema?: ZodType<T>
}

// ---------------------------------------------------------------------------
// Transport seam (cookie for web, bearer for the Capacitor wrapper)
// ---------------------------------------------------------------------------

export type AuthTransport =
  | { readonly kind: "cookie" }
  | {
      readonly kind: "bearer"
      readonly getAccessToken: () => string | null | Promise<string | null>
    }

let authTransport: AuthTransport = { kind: "cookie" }

/** The wrapper build swaps in `{kind: "bearer", getAccessToken}` (todo 29). */
export function setAuthTransport(transport: AuthTransport): void {
  authTransport = transport
}

export function getAuthTransport(): AuthTransport {
  return authTransport
}

// ---------------------------------------------------------------------------
// Forced logout (the auth store of todo 8 wires the real handler)
// ---------------------------------------------------------------------------

export type ForcedLogoutReason = "refresh-failed" | "retry-unauthorized"
export type ForcedLogoutHandler = (reason: ForcedLogoutReason) => void

let forcedLogoutHandler: ForcedLogoutHandler | null = null
let sessionTerminated = false

/**
 * Registers the layer that wipes the session (cache, store, redirect). It is
 * called at most once per expiry cycle; `resetSession()` re-arms it.
 */
export function setForcedLogoutHandler(handler: ForcedLogoutHandler | null): void {
  forcedLogoutHandler = handler
}

function forceLogout(reason: ForcedLogoutReason): void {
  if (sessionTerminated) return
  sessionTerminated = true
  forcedLogoutHandler?.(reason)
}

/** Re-arms refresh/logout after a fresh login (called by the auth layer). */
export function resetSession(): void {
  sessionTerminated = false
}

// ---------------------------------------------------------------------------
// Request core
// ---------------------------------------------------------------------------

export function apiFetch<T>(
  path: string,
  options: ApiFetchOptions<T> & { schema: ZodType<T> },
): Promise<T>
export function apiFetch(path: string, options?: RequestOptions): Promise<undefined>
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions<T> = {},
): Promise<T | undefined> {
  let response = await sendRequest(path, options)
  if (response.status === UNAUTHORIZED && options.skipAuthRefresh !== true) {
    response = await refreshAndRetry(path, options, response)
  }
  return decodeResponse(response, path, options)
}

/**
 * Text variant of `apiFetch` for downloads (spec L546/L614, contract §9): the
 * body comes back as a string so the caller can validate it (`bundleSchema`)
 * and hand it to the browser as a Blob. Auth, `credentials` and the
 * single-flight 401 refresh ride the same request core, so the export URL
 * never carries a token.
 */
export async function apiFetchText(path: string, options: RequestOptions = {}): Promise<string> {
  let response = await sendRequest(path, options)
  if (response.status === UNAUTHORIZED && options.skipAuthRefresh !== true) {
    response = await refreshAndRetry(path, options, response)
  }
  if (!response.ok) throw await toApiError(response)
  return response.text()
}

/**
 * 401 flow (spec L150-L156): one refresh shared by every concurrent 401,
 * retry the original exactly once, and force logout when that retry is again
 * rejected or when the refresh itself failed.
 */
async function refreshAndRetry(
  path: string,
  options: RequestOptions,
  unauthorized: Response,
): Promise<Response> {
  if (sessionTerminated) return unauthorized

  try {
    await refreshSession()
  } catch {
    // `refreshSession` already emitted the single forced logout. A failed
    // refresh is never retried — return the original 401.
    return unauthorized
  }

  const retry = await sendRequest(path, options)
  if (retry.status === UNAUTHORIZED) {
    forceLogout("retry-unauthorized")
  }
  return retry
}

async function decodeResponse<T>(
  response: Response,
  path: string,
  options: ApiFetchOptions<T>,
): Promise<T | undefined> {
  if (!response.ok) throw await toApiError(response)
  if (isNoContent(response.status)) return undefined

  const schema = options.schema
  if (!schema) return undefined

  const first = schema.safeParse(await readJsonOrUndefined(response))
  if (first.success) return first.data

  warnSchemaMismatch(path, first.error)

  // Exactly one refetch on a schema mismatch; no refresh dance, no loop.
  const refetched = await sendRequest(path, options)
  if (!refetched.ok) throw await toApiError(refetched)
  if (isNoContent(refetched.status)) return undefined

  const second = schema.safeParse(await readJsonOrUndefined(refetched))
  if (second.success) return second.data

  warnSchemaMismatch(path, second.error)
  throw new ApiParseError(refetched.status)
}

async function sendRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers(options.headers)
  const hasBody = options.body !== undefined
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  if (authTransport.kind === "bearer") {
    const token = await authTransport.getAccessToken()
    if (token !== null && token.length > 0) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }

  return fetch(toRequestUrl(path), {
    method: options.method ?? "GET",
    headers,
    credentials: authTransport.kind === "cookie" ? "include" : "omit",
    signal: options.signal,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
}

function toRequestUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`apiFetch requires a root-relative path starting with "/" (received "${path}")`)
  }
  // Appended verbatim: the trailing slash is part of the contract (§1.1).
  return `${getApiBaseUrl()}${path}`
}

function isNoContent(status: number): boolean {
  return status === NO_CONTENT || status === RESET_CONTENT
}

/**
 * Reads a body as JSON when possible. Non-JSON and empty bodies resolve
 * `undefined` — the caller decides whether that is acceptable (error path) or
 * a schema mismatch (success path).
 */
async function readJsonOrUndefined(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim().length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const envelope: unknown = await readJsonOrUndefined(response)
  const detail = detailFromEnvelope(envelope) ?? statusDetail(response)
  const fieldErrors =
    response.status === UNPROCESSABLE_ENTITY ? fieldErrorsFromEnvelope(envelope) : undefined
  return new ApiError({ status: response.status, detail, fieldErrors })
}

function statusDetail(response: Response): string {
  const statusText = response.statusText.trim()
  return statusText.length > 0 ? `HTTP ${response.status} ${statusText}` : `HTTP ${response.status}`
}

function warnSchemaMismatch(path: string, error: ZodError): void {
  console.warn(
    `[mirrorr-api] response for ${path} did not match its schema; the client refetches once`,
    error.issues,
  )
}

// ---------------------------------------------------------------------------
// Refresh (single-flight) — shared by the 401 flow and the proactive checks
// ---------------------------------------------------------------------------

/** The one shared in-flight refresh; null when no refresh is running. */
let refreshInFlight: Promise<AuthResponse> | null = null

/**
 * Persistence seam for the wrapper build (spec L597): the rotated pair a refresh
 * returns must reach secure storage BEFORE any waiter retries, so a retry can
 * never present a token the server has already rotated away (JTI rotation makes
 * an unpersisted replay invalidate the whole session). The hook is awaited
 * inside the shared promise, ahead of its resolution, which is what makes that
 * ordering a property of this module rather than of every caller. A rejection
 * fails the refresh closed — an undurable token pair is not a usable session.
 */
export type RefreshPersister = (response: AuthResponse) => void | Promise<void>

let refreshPersister: RefreshPersister | null = null

export function setRefreshPersister(persister: RefreshPersister | null): void {
  refreshPersister = persister
}

async function performRefresh(): Promise<AuthResponse> {
  const response = await sendRequest(REFRESH_PATH, { method: "POST", body: {} })
  if (!response.ok) throw await toApiError(response)

  const parsed = authResponseSchema.safeParse(await readJsonOrUndefined(response))
  if (!parsed.success) {
    // Refresh is NEVER retried: a malformed 200 is a failed refresh.
    throw new ApiParseError(response.status)
  }
  return parsed.data
}

/**
 * Starts (or joins) the one in-flight `POST /auth/refresh`.
 *
 * Every concurrent 401 awaits the same promise, so JTI rotation cannot race
 * and exactly one refresh request is ever in flight. A rejection emits the
 * single forced logout and is never retried.
 */
export function refreshSession(): Promise<AuthResponse> {
  refreshInFlight ??= performRefresh()
    .then(
      async (response) => {
        await refreshPersister?.(response)
        markSessionRefreshed()
        return response
      },
      (error: unknown) => {
        forceLogout("refresh-failed")
        throw error
      },
    )
    .finally(() => {
      refreshInFlight = null
    })

  return refreshInFlight
}

// ---------------------------------------------------------------------------
// Proactive refresh: 23h timer + visibilitychange, both gated on >1h staleness
// ---------------------------------------------------------------------------

let lastRefreshAt: number | null = null

/**
 * Records a successful authentication event (login or refresh). The auth
 * layer of todo 8 calls this after login; `refreshSession` calls it itself.
 */
export function markSessionRefreshed(at: number = Date.now()): void {
  lastRefreshAt = at
  sessionTerminated = false
}

export interface VisibilityEventSource {
  addEventListener(type: "visibilitychange", listener: () => void): void
  removeEventListener(type: "visibilitychange", listener: () => void): void
}

export interface ProactiveRefreshOptions {
  readonly now?: () => number
  readonly setIntervalFn?: (callback: () => void, intervalMs: number) => number
  readonly clearIntervalFn?: (handle: number) => void
  readonly visibilitySource?: VisibilityEventSource
  readonly getVisibilityState?: () => DocumentVisibilityState
}

function shouldRefreshProactively(at: number): boolean {
  return (
    !sessionTerminated && lastRefreshAt !== null && at - lastRefreshAt > MIN_REFRESH_AGE_MS
  )
}

/**
 * The shared staleness rule applied on demand: the 23h timer, the
 * `visibilitychange` handler and the wrapper's `appStateChange` resume all
 * route through here, so ">1h since the last successful refresh" is stated
 * once (spec L150-L156, L600).
 */
export function refreshSessionIfStale(at: number = Date.now()): void {
  if (!shouldRefreshProactively(at)) return
  void refreshSession().catch(() => {
    // The failure already emitted the one forced logout; swallow so a timer or
    // a lifecycle event never produces an unhandled rejection.
  })
}

/**
 * Starts the proactive refresh rules and returns a stop function.
 *
 * The 23h timer and the `visibilitychange` handler both refresh ONLY when the
 * last successful refresh is more than an hour old. Clock, timers, event
 * source and visibility read are injectable so tests can drive them.
 */
export function startProactiveRefresh(options: ProactiveRefreshOptions = {}): () => void {
  const now = options.now ?? Date.now
  const setIntervalFn =
    options.setIntervalFn ?? ((callback, intervalMs) => globalThis.setInterval(callback, intervalMs))
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => globalThis.clearInterval(handle))
  const visibilitySource = options.visibilitySource ?? document
  const getVisibilityState = options.getVisibilityState ?? (() => document.visibilityState)

  const tick = (): void => {
    refreshSessionIfStale(now())
  }

  const onVisibilityChange = (): void => {
    if (getVisibilityState() === "visible") tick()
  }

  const handle = setIntervalFn(tick, PROACTIVE_REFRESH_INTERVAL_MS)
  visibilitySource.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    clearIntervalFn(handle)
    visibilitySource.removeEventListener("visibilitychange", onVisibilityChange)
  }
}
