import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const PluginsView = lazy(() =>
  import("@/views/plugins/plugins").then((m) => ({ default: m.PluginsView })),
)

export const pluginsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/plugins",
  component: PluginsRouteView,
})

function PluginsRouteView() {
  return (
    <Suspense fallback={null}>
      <PluginsView />
    </Suspense>
  )
}
