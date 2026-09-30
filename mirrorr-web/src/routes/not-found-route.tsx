import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { rootRoute } from "@/routes/root-route"

// Brief IMPROVEMENT #1: lazy view import for route-level code-splitting.
const NotFoundView = lazy(() =>
  import("@/components/PlaceholderView").then((module) => ({ default: module.PlaceholderView })),
)

/** `*` catch-all (scaffold placeholder — real 404 view lands per design spec). */
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
