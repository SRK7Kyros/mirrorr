import { createRoute, redirect } from "@tanstack/react-router"
import { RegisterView } from "@/components/auth/RegisterView"
import { RoutePending } from "@/components/ui/RoutePending"
import { ensureAuthStatus, isAuthenticated } from "@/lib/auth-guard"
import { publicLayoutRoute } from "@/routes/public-layout-route"

/**
 * V2 bootstrap (spec L35, L252): reachable only while `has_users` is false;
 * every other outcome (users exist, status unknown) falls back to `/login`.
 */
export const registerRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/register",
  beforeLoad: async () => {
    if (isAuthenticated()) {
      throw redirect({ to: "/sessions" })
    }

    let hasUsers: boolean
    try {
      hasUsers = (await ensureAuthStatus()).has_users
    } catch {
      throw redirect({ to: "/login" })
    }
    if (hasUsers) {
      throw redirect({ to: "/login" })
    }
  },
  pendingComponent: RoutePending,
  pendingMs: 0,
  component: RegisterView,
})
