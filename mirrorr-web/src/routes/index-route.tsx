import { createRoute, redirect } from "@tanstack/react-router"
import { isAuthenticated, redirectToLogin } from "@/lib/auth"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * `/` — unauthenticated → /login (explicit; the auth-layout guard is the
 * primary), authenticated → /sessions.
 */
export const indexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/",
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      redirectToLogin(location)
    }
    throw redirect({ to: "/sessions" })
  },
})
