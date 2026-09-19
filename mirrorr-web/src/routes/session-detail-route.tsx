import { createRoute } from "@tanstack/react-router"
import { SessionDetailView } from "@/components/sessions/SessionDetailView"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/** V4 — the session detail / live monitor (spec L267-L277). */
export const sessionDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions/$sessionId",
  component: SessionDetailPage,
})

function SessionDetailPage() {
  const { sessionId } = sessionDetailRoute.useParams()
  // Non-numeric ids (`/sessions/abc`) render the "Session not found" state.
  return <SessionDetailView sessionId={Number.parseInt(sessionId, 10)} />
}
