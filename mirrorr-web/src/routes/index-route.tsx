import { createRoute, redirect } from "@tanstack/react-router"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/** `/` is the authenticated index (spec L37): it always lands on `/sessions`. */
export const indexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" })
  },
})
