import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const AutorunDetail = lazy(() =>
  import("@/views/autoruns/autorun-detail").then((m) => ({ default: m.AutorunDetail })),
)

export const autorunsDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/autoruns/$autorunId",
  component: AutorunDetailRouteView,
})

function AutorunDetailRouteView() {
  return (
    <Suspense fallback={null}>
      <AutorunDetail />
    </Suspense>
  )
}
