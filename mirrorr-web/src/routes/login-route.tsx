import { createRoute, redirect } from "@tanstack/react-router"
import { LoginView } from "@/components/auth/LoginView"
import { sanitizeRedirectPath } from "@/lib/auth-redirect"
import { isAuthenticated } from "@/lib/auth-guard"
import { publicLayoutRoute } from "@/routes/public-layout-route"

export interface LoginSearch {
  readonly redirect?: string
}

export const loginRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const redirectPath = sanitizeRedirectPath(search.redirect)
    return redirectPath === null ? {} : { redirect: redirectPath }
  },
  beforeLoad: () => {
    if (isAuthenticated()) {
      throw redirect({ to: "/sessions" })
    }
  },
  component: LoginRouteView,
})

function LoginRouteView() {
  const { redirect: redirectPath } = loginRoute.useSearch()
  return <LoginView redirectPath={redirectPath ?? null} />
}
