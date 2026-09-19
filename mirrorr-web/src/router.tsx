import { createRouter } from "@tanstack/react-router"
import { authLayoutRoute } from "@/routes/auth-layout-route"
import { dataProbeRoute } from "@/routes/data-probe-route"
import { indexRoute } from "@/routes/index-route"
import { loginRoute } from "@/routes/login-route"
import { notFoundRoute } from "@/routes/not-found-route"
import {
  autorunsRoute,
  importExportRoute,
  pluginsRoute,
  profilesRoute,
  recordingsRoute,
  settingsClientsRoute,
  settingsRoute,
  settingsUsersRoute,
} from "@/routes/placeholder-routes"
import { publicLayoutRoute } from "@/routes/public-layout-route"
import { registerRoute } from "@/routes/register-route"
import { rootRoute } from "@/routes/root-route"
import { sessionsRoute } from "@/routes/sessions-route"

export const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([loginRoute, registerRoute]),
  authLayoutRoute.addChildren([
    indexRoute,
    sessionsRoute,
    autorunsRoute,
    recordingsRoute,
    profilesRoute,
    pluginsRoute,
    importExportRoute,
    settingsRoute,
    settingsUsersRoute,
    settingsClientsRoute,
    dataProbeRoute,
  ]),
  notFoundRoute,
])

export const router = createRouter({
  routeTree,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
