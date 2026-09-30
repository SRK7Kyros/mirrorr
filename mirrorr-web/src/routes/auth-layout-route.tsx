import { createRoute, Outlet } from "@tanstack/react-router"
import { AppShell } from "@/components/chrome/AppShell"
import { ensureAuthMe, redirectToLogin } from "@/lib/auth"
import { rootRoute } from "@/routes/root-route"

/**
 * Authenticated branch: every non-public route nests here behind the guard
 * and renders inside the AppShell chrome (spec §3 — sidebar/rail/tabbar
 * responsive shell; the outlet is the sole main-body scroller).
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
