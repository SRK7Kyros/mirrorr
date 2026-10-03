import { createRoute, Outlet } from "@tanstack/react-router"
import { AppShell } from "@/shells"
import { ensureAuthMe, redirectToLogin } from "@/lib/auth"
import { rootRoute } from "@/routes/root-route"

/**
 * Authenticated branch: every non-public route nests here behind the guard
 * and renders inside the console shell (spec §3 Variant A / §4 Variant B —
 * `@/shells` selects between them; the outlet is the region that scrolls).
 */
export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: async ({ location }) => {
    try {
      await ensureAuthMe()
    } catch {
      redirectToLogin(location)
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
