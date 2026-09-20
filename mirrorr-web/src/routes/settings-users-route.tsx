import { createRoute } from "@tanstack/react-router"
import { SettingsUsersView } from "@/components/settings/SettingsUsersView"
import { requireAdmin } from "@/lib/auth-guard"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * V12 `/settings/users` — admin-gated Users tab (spec L375-L384, L29).
 * The guard redirects a non-admin to `/settings` before the view renders.
 */
export const settingsUsersRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/users",
  beforeLoad: requireAdmin,
  component: SettingsUsersView,
})
