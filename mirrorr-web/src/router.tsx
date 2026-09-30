import { createRouter } from "@tanstack/react-router"
import { authLayoutRoute } from "@/routes/auth-layout-route"
import { autorunsDetailRoute } from "@/routes/autoruns-detail-route"
import { autorunsRoute } from "@/routes/autoruns-route"
import { importExportRoute } from "@/routes/import-export-route"
import { indexRoute } from "@/routes/index-route"
import { loginRoute } from "@/routes/login-route"
import { notFoundRoute } from "@/routes/not-found-route"
import { pluginsRoute } from "@/routes/plugins-route"
import { profilesRoute } from "@/routes/profiles-route"
import { publicLayoutRoute } from "@/routes/public-layout-route"
import { recordingsRoute } from "@/routes/recordings-route"
import { registerRoute } from "@/routes/register-route"
import { rootRoute } from "@/routes/root-route"
import { sessionsDetailRoute } from "@/routes/sessions-detail-route"
import { sessionsRoute } from "@/routes/sessions-route"
import { settingsRoute } from "@/routes/settings-route"

/**
 * Two-branch tree (brief KEEP + IMPROVEMENT #1): a public branch for
 * unauthenticated pages and an authenticated branch behind the guard — each
 * leaf route lazy-imports its view for code-splitting.
 */
export const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([loginRoute, registerRoute]),
  authLayoutRoute.addChildren([
    indexRoute,
    sessionsRoute.addChildren([sessionsDetailRoute]),
    autorunsRoute.addChildren([autorunsDetailRoute]),
    recordingsRoute,
    profilesRoute,
    pluginsRoute,
    importExportRoute,
    settingsRoute,
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
