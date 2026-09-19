import { createRoute, Outlet } from "@tanstack/react-router"
import { rootRoute } from "@/routes/root-route"

/** Public branch (spec L31): `/login` and `/register`, no auth beforeLoad. */
export const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  component: PublicLayout,
})

function PublicLayout() {
  return <Outlet />
}
