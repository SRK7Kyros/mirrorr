import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const SessionsView = lazy(() =>
  import("@/views/sessions/sessions-list").then((module) => ({ default: module.SessionsList })),
)

export const sessionsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions",
  component: SessionsRouteView,
})

function SessionsRouteView() {
  return (
    <Suspense fallback={null}>
      <SessionsView />
    </Suspense>
  )
}
