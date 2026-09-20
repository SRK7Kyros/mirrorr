import { createRoute } from "@tanstack/react-router"
import { SettingsAccountView } from "@/components/settings/SettingsAccountView"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * V11 `/settings` — Account tab (spec L364-L373).
 * No route-level data: the user card reads the auth store and the
 * change-password form posts `POST /auth/change-password`.
 */
export const settingsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings",
  component: SettingsAccountView,
})
