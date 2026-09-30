import { createRoute, redirect } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authStatusKey } from "@/hooks/use-auth-status"
import { apiFetch } from "@/lib/api"
import { isAuthenticated } from "@/lib/auth"
import { queryClient } from "@/query-client"
import { publicLayoutRoute } from "@/routes/public-layout-route"
import { AuthStatusSchema } from "@/lib/schemas"

const RegisterView = lazy(() =>
  import("@/views/auth/register-view").then((module) => ({ default: module.RegisterView })),
)

/**
 * `/register` — public bootstrap only (general-client spec guard):
 * authenticated → /sessions; `has_users === true` → /login; fetch failure
 * (429/network) leaves status unknown and the view redirects to /login.
 * Export: `registerRoute` (NOT yet mounted in router.tsx).
 */
export const registerRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/register",
  beforeLoad: async () => {
    if (isAuthenticated()) {
      throw redirect({ to: "/sessions" })
    }
    let hasUsers: boolean | null = null
    try {
      const status = AuthStatusSchema.parse(
        await apiFetch<unknown>("/auth/status", { skipAuthRefresh: true }),
      )
      queryClient.setQueryData(authStatusKey, status)
      hasUsers = status.has_users
    } catch {
      hasUsers = null
    }
    if (hasUsers === true) {
      throw redirect({ to: "/login" })
    }
  },
  component: RegisterRouteView,
})

function RegisterRouteView() {
  return (
    <Suspense fallback={null}>
      <RegisterView />
    </Suspense>
  )
}
