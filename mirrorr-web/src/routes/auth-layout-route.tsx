import { createRoute, Outlet } from "@tanstack/react-router"
import { RoutePending } from "@/components/ui/RoutePending"
import { ensureAuthMe, redirectToLogin } from "@/lib/auth-guard"
import { rootRoute } from "@/routes/root-route"

/**
 * Authenticated branch (spec L31, L150-L156): every non-public route nests
 * here. The guard reads cached `["auth","me"]`; `apiFetch` owns the 401 →
 * one refresh → one retry dance; failure redirects to `/login?redirect=…`.
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
  pendingComponent: RoutePending,
  pendingMs: 0,
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return <Outlet />
}
