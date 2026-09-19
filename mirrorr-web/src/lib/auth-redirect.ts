/**
 * The `?redirect` contract (docs/web-frontend-spec.md L31, L35, L53).
 *
 * After login the client navigates to a same-origin PATH. Absolute URLs and
 * protocol-relative `//host` values are rejected so the login page can never
 * be turned into an open redirect; every rejection falls back to `/sessions`.
 */
export const DEFAULT_POST_LOGIN_PATH = "/sessions"

/**
 * Returns the path to navigate to after login, or `null` when the candidate is
 * absent or unsafe. Accepts only a non-empty string that starts with `/` and
 * does not start with `//` — no other origin is ever followed.
 */
export function sanitizeRedirectPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  if (raw.length === 0) return null
  if (!raw.startsWith("/")) return null
  if (raw.startsWith("//")) return null
  return raw
}

/** The requested redirect when it is safe, `/sessions` otherwise. */
export function postLoginPath(raw: unknown): string {
  return sanitizeRedirectPath(raw) ?? DEFAULT_POST_LOGIN_PATH
}
