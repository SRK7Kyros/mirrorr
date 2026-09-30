import { createRoute } from "@tanstack/react-router"
import { ImportExportView } from "@/components/import-export/ImportExportView"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export const importExportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/import-export",
  component: ImportExportView,
})
