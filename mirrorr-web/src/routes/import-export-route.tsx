import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const ImportExportView = lazy(() =>
  import("@/views/import-export/import-export").then((m) => ({ default: m.ImportExportView })),
)

export const importExportRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/import-export",
  component: ImportExportRouteView,
})

function ImportExportRouteView() {
  return (
    <Suspense fallback={null}>
      <ImportExportView />
    </Suspense>
  )
}
