import { createRoute } from "@tanstack/react-router"
import { NotFoundView } from "@/components/NotFoundView"
import { rootRoute } from "@/routes/root-route"

/** `*` not-found view (spec L49): spec copy plus a link home. */
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: NotFoundView,
})
