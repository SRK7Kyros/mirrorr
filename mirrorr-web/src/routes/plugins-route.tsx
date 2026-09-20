import { createRoute } from "@tanstack/react-router"
import { PluginsView } from "@/components/plugins/PluginsView"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export const pluginsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/plugins",
  component: PluginsView,
})
