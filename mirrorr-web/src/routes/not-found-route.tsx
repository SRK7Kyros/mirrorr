import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { rootRoute } from "@/routes/root-route"

// Brief IMPROVEMENT #1: lazy view import for route-level code-splitting.
const NotFoundView = lazy(() =>
  import("@/views/auth/not-found-view").then((module) => ({ default: module.NotFoundView })),
)

/**
 * `*` catch-all. Not nested under the auth layout on purpose: a 404 must render
 * for anonymous visitors too (the auth branch would redirect to /login). The
 * design spec's "rail + topbar stay" is therefore a router-tree gap, not a view
 * gap — reported at handoff.
 */
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: NotFoundRouteView,
})

function NotFoundRouteView() {
  return (
    <Suspense fallback={null}>
      <NotFoundView />
    </Suspense>
  )
}
