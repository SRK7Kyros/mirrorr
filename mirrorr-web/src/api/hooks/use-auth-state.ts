import { useSyncExternalStore } from "react"
import { getAuthState, subscribeAuth, type AuthState } from "@/api/auth"

/** Auth store subscription for chrome (display name, API-client principal). */
export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribeAuth, getAuthState, getAuthState)
}
