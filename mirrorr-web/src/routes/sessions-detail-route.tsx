import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const SessionDetail = lazy(() =>
  import("@/views/sessions/session-detail").then((m) => ({ default: m.SessionDetail })),
)

export const sessionsDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions/$sessionId",
  component: SessionDetailRouteView,
})

function SessionDetailRouteView() {
  return (
    <Suspense fallback={null}>
      <SessionDetail />
    </Suspense>
  )
}
