import { useQuery } from "@tanstack/react-query"
import { fetchAuthStatus } from "@/lib/auth"
import { AUTH_STATUS_STALE_TIME_MS } from "@/lib/auth-guard"
import { ApiError } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"

export interface AuthStatusState {
  /** `null` until the public status probe has answered. */
  readonly hasUsers: boolean | null
  readonly rateLimited: boolean
}

export function useAuthStatus(): AuthStatusState {
  const query = useQuery({
    queryKey: queryKeys.authStatus(),
    queryFn: fetchAuthStatus,
    staleTime: AUTH_STATUS_STALE_TIME_MS,
    retry: false,
  })

  return {
    hasUsers: query.data?.has_users ?? null,
    rateLimited: query.error instanceof ApiError && query.error.status === 429,
  }
}
