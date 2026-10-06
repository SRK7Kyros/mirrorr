import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { apiFetch } from "@/api/client"
import { useAuthState } from "./use-auth-state"
import { queryKeys, staleTimes } from "@/api/query-keys"
import { NotificationSchema } from "@/api/schemas"

/** GET /notifications/ returns a bare array (trailing slash — no redirects). */
const NotificationListSchema = z.array(NotificationSchema)

/** REST notifications — bell badge + drawer source; disabled for API clients (401). */
export function useNotifications() {
  const auth = useAuthState()
  const enabled = auth.auth?.user != null
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: async () =>
      NotificationListSchema.parse(await apiFetch<unknown>("/notifications/")),
    staleTime: staleTimes.notifications,
    enabled,
  })
}

function useInvalidateNotifications(): () => void {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: (id: number) => apiFetch<unknown>(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: () => apiFetch<unknown>("/notifications/read-all", { method: "POST" }),
    onSuccess: invalidate,
  })
}

export function useDeleteNotification() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: (id: number) => apiFetch<unknown>(`/notifications/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  })
}
