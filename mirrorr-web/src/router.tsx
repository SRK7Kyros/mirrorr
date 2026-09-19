import { createRouter } from "@tanstack/react-router"
import { dataProbeRoute } from "@/routes/data-probe-route"
import { indexRoute } from "@/routes/index-route"
import { rootRoute } from "@/routes/root-route"

export const routeTree = rootRoute.addChildren([indexRoute, dataProbeRoute])

export const router = createRouter({
  routeTree,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
