/**
 * Todo 21 (spec L158, L647): the persistent API-client banner — "Acting as
 * API client '<name>' — created resources belong to no user and produce no
 * notifications". It substitutes for the bell (suppressed for API-key
 * principals) and stays mounted for the whole session.
 */
import { useSyncExternalStore } from "react"
import { getAuthState, isApiClientPrincipal, subscribeToAuth } from "@/lib/auth-store"

export function apiClientBannerText(name: string): string {
  return `Acting as API client '${name}' — created resources belong to no user and produce no notifications`
}

export function ApiClientBanner() {
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)

  if (!isApiClientPrincipal(auth) || auth.client === null) return null

  return (
    <div
      role="status"
      data-testid="api-client-banner"
      className="flex w-full items-center justify-center gap-2 border-b border-info/30 bg-info/12 px-3 py-2 text-small text-info"
    >
      {apiClientBannerText(auth.client.name)}
    </div>
  )
}
