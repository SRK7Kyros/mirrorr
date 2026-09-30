import { createRoute } from "@tanstack/react-router"
import { SettingsClientsView } from "@/components/settings/SettingsClientsView"
import { requireAdmin } from "@/lib/auth-guard"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * V13 `/settings/clients` — admin-gated API clients tab (spec L386-L395).
 * The client contract §10.2 keeps key creation admin-only, same guard as V12.
 */
export const settingsClientsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/clients",
  beforeLoad: requireAdmin,
  component: SettingsClientsView,
})
