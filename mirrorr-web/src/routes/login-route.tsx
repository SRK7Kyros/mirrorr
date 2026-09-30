import { createRoute, redirect } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { isAuthenticated, sanitizeRedirectPath } from "@/lib/auth"
import { publicLayoutRoute } from "@/routes/public-layout-route"

// Brief IMPROVEMENT #1: each leaf route lazy-imports its view so every page
// is its own chunk (the split the earlier greenfield dropped).
const LoginView = lazy(() =>
  import("@/views/auth/login-view").then((module) => ({ default: module.LoginView })),
)

export const loginRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { readonly redirect?: string } => {
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
  return (
    <Suspense fallback={null}>
      <LoginView />
    </Suspense>
  )
}
