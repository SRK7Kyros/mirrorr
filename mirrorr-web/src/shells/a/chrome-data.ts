/**
 * chrome-data.ts — the shell's single read-only data source.
 *
 * §3: exactly ONE read-only hook per concern. This module is the seam the
 * orchestrator repoints at data hooks (WS state, auth, notifications); it is
 * deliberately the only place in `shells/a` that touches an app module, and it
 * passes real values straight through with no fixture fallback, so a stale
 * fixture can never masquerade as live state.
 */
import { isApiClientPrincipal as isApiClientPrincipalRaw } from "@/lib/auth"
import { useAuthState as useAuthStateRaw } from "@/hooks/use-auth-state"
import type { AuthResponse } from "@/lib/schemas"
import type { AuthState } from "@/lib/auth"

export { API_CLIENT_POLL_LABEL } from "@/lib/auth"
export { useRealtimeState } from "@/hooks/use-realtime-state"
export type { AuthState }

export function useAuthState(): AuthState {
  return useAuthStateRaw()
}

/**
 * The auth store's state annotation widens `auth` away from the zod-inferred
 * `AuthResponse`, so the seam re-narrows the value to the schema type the
 * helper actually takes.
 */
export function isApiClientPrincipal(auth: AuthState["auth"] | AuthResponse | null = null): boolean {
  return isApiClientPrincipalRaw((auth ?? null) as AuthResponse | null)
}
