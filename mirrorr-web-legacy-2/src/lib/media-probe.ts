/**
 * V7's media reachability probe.
 *
 * Contract: `docs/web-frontend-spec.md` L319 and client contract
 * §13.11.5/§13.12.2 — `content_url` is a static link, served only when the
 * operator enables media serving. Probing is allowed exactly ONCE per browser
 * session, on the first "Open" click, never per row. A 403/404 (or a network
 * failure) is reported as `unreachable` so the view can toast "Media not
 * reachable — file may not be served".
 */

export type MediaProbeOutcome =
  | { readonly kind: "reachable" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "already-probed" }

let probedThisSession = false

/** Test seam: a fresh page load is a fresh session. */
export function resetMediaProbeSession(): void {
  probedThisSession = false
}

export interface MediaProbeOptions {
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

/**
 * Probes `url` with one HEAD request unless this session already probed.
 * Never throws: any failure is `unreachable`.
 */
export async function probeMediaOnce(
  url: string,
  options: MediaProbeOptions = {},
): Promise<MediaProbeOutcome> {
  if (probedThisSession) return { kind: "already-probed" }
  probedThisSession = true

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, { method: "HEAD" })
    return response.ok ? { kind: "reachable" } : { kind: "unreachable" }
  } catch {
    return { kind: "unreachable" }
  }
}
