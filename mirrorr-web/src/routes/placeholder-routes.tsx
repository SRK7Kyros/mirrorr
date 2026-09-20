import { createRoute } from "@tanstack/react-router"
import { PlaceholderPage } from "@/components/dev/PlaceholderPage"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * Minimal children for the not-yet-built authenticated views (spec L33-L49).
 * They exist so guard redirects and later waves have real targets.
 * Settings (V11-V13) moved to real routes; only import-export remains.
 */
export const importExportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/import-export",
  component: () => <PlaceholderPage title="Import / Export" testId="import-export-placeholder" />,
})
