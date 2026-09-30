import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { AuthStatusSchema } from "@/lib/schemas"

/** Public bootstrap probe (GET /auth/status) — V1 register link + V2 guard. */
export const authStatusKey = ["auth", "status"] as const

/** Generous staleTime: contract forbids hammering this rate-limited probe. */
const AUTH_STATUS_STALE_MS = 60_000

export interface AuthStatusInfo {
  readonly has_users: boolean
}

export interface AuthStatusResult {
  /** `undefined` while loading OR after a failed/429 fetch (treat as unknown). */
  readonly status: AuthStatusInfo | undefined
  readonly isLoading: boolean
}

export function useAuthStatus(): AuthStatusResult {
  const query = useQuery({
    queryKey: authStatusKey,
    queryFn: async () =>
      AuthStatusSchema.parse(await apiFetch<unknown>("/auth/status", { skipAuthRefresh: true })),
    staleTime: AUTH_STATUS_STALE_MS,
    retry: false,
  })
  return { status: query.data, isLoading: query.isLoading }
}
