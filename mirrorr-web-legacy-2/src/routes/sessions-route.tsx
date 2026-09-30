import { createRoute } from "@tanstack/react-router"
import { SessionsView } from "@/components/sessions/SessionsView"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/** V3 — the sessions list (spec L263-L273), the authenticated landing. */
export const sessionsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions",
  component: SessionsView,
})
