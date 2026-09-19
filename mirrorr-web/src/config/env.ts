/**
 * The API configuration contract — the only module in `src/` that reads
 * `VITE_API_URL`.
 *
 * Contract (`docs/web-frontend-spec.md` L116, L586-L589, L646):
 *
 * - `VITE_API_URL` is the single configuration value, baked at build time for
 *   both form factors; there is no runtime server picker in v1.
 * - It must be non-empty and must NOT end with a trailing slash (the server
 *   runs with `redirect_slashes=False`, and the client appends exact paths).
 * - It is either root-relative (`/api` — development, same-origin through the
 *   Vite proxy) or an absolute `http(s)://` origin, optionally with a path.
 * - A missing or malformed value fails LOUDLY at boot (`assertApiConfig()` is
 *   called from `main.tsx` before the React tree mounts), never as an opaque
 *   fetch or WebSocket error.
 *
 * WebSocket URLs are DERIVED, never configured: take the base's ORIGIN — the
 * page origin for a root-relative base — map `http→ws` / `https→wss`, and
 * append `/ws/events` or `/ws/notifications`. The base's path is discarded on
 * purpose, so `/api` yields `/ws/events`, never `/api/ws/events`.
 */
export const API_URL_ENV_VAR = "VITE_API_URL"

/**
 * The ONE and ONLY `VITE_API_URL` read site in `src/`.
 *
 * In a production build Vite statically replaces the expression with the baked
 * value (or `undefined` when unset), so the boot guard below also covers a
 * bundle that was built without configuration.
 */
function readRawApiUrl(): string | undefined {
  const value: unknown = import.meta.env.VITE_API_URL
  return typeof value === "string" ? value : undefined
}

/**
 * Validates and normalises one candidate base URL. Pure, so every rejection
 * branch is unit-testable without touching `import.meta.env`.
 */
export function parseApiBaseUrl(raw: string | undefined): string {
  const candidate = raw?.trim() ?? ""

  if (candidate.length === 0) {
    throw new Error(
      `Missing configuration: ${API_URL_ENV_VAR} must be set to a non-empty API base URL — ` +
        `an absolute http(s) origin for production builds (for example ` +
        `https://mirrorr.example.org), or "/api" in development behind the Vite proxy.`,
    )
  }

  if (candidate.endsWith("/")) {
    throw new Error(
      `Invalid ${API_URL_ENV_VAR}: a trailing slash is not allowed (received "${candidate}"). ` +
        `Use "https://host" or "https://host/base" without a trailing slash.`,
    )
  }

  if (candidate.startsWith("/")) {
    return candidate
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(
      `Invalid ${API_URL_ENV_VAR}: expected a root-relative path like "/api" or an absolute ` +
        `http(s) URL (received "${candidate}").`,
    )
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Invalid ${API_URL_ENV_VAR}: only the http and https schemes are supported ` +
        `(received "${candidate}").`,
    )
  }

  return candidate
}

/** Reads, validates, and returns the configured API base URL. */
export function getApiBaseUrl(): string {
  return parseApiBaseUrl(readRawApiUrl())
}

/**
 * Boot guard: called once from `main.tsx` before mount. A missing or malformed
 * value throws immediately, naming the variable.
 */
export function assertApiConfig(): string {
  return getApiBaseUrl()
}

/** WebSocket channel paths, appended to the derived origin (never the base path). */
const WS_CHANNEL_PATHS = {
  events: "/ws/events",
  notifications: "/ws/notifications",
} as const

export type WsChannel = keyof typeof WS_CHANNEL_PATHS

/**
 * Derives the WebSocket URL for a channel from the configured base's ORIGIN.
 *
 * A root-relative base (`/api`) resolves against the page origin; an absolute
 * base contributes only its origin (its path is dropped). The scheme maps
 * `http→ws` / `https→wss`, so `https://host/x` → `wss://host/ws/events` and
 * `/api` → `ws://<page-origin>/ws/events` — never `/api/ws/events`.
 */
export function getWebSocketUrl(channel: WsChannel): string {
  const resolved = new URL(getApiBaseUrl(), window.location.href)
  const protocol = resolved.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${resolved.host}${WS_CHANNEL_PATHS[channel]}`
}

export function getWsEventsUrl(): string {
  return getWebSocketUrl("events")
}

export function getWsNotificationsUrl(): string {
  return getWebSocketUrl("notifications")
}
