import { createRoute } from "@tanstack/react-router"
import { PlaceholderPage } from "@/components/dev/PlaceholderPage"
import { requireAdmin } from "@/lib/auth-guard"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * Minimal children for the not-yet-built authenticated views (spec L33-L49).
 * They exist so guard redirects and later waves have real targets.
 */
export const importExportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/import-export",
  component: () => <PlaceholderPage title="Import / Export" testId="import-export-placeholder" />,
})

export const settingsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings",
  component: () => <PlaceholderPage title="Settings" testId="settings-placeholder" />,
})

export const settingsUsersRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/users",
  beforeLoad: requireAdmin,
  component: () => <PlaceholderPage title="Users" testId="settings-users-placeholder" />,
})

export const settingsClientsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/clients",
  beforeLoad: requireAdmin,
  component: () => <PlaceholderPage title="API clients" testId="settings-clients-placeholder" />,
})
