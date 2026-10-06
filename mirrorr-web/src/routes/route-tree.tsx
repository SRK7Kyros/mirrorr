import { Outlet, createRootRoute, createRoute, redirect } from "@tanstack/react-router"
import { ensureAuthMe, getAuthState } from "@/api"
import { AppShell } from "@/ui/chrome/app-shell"
import { AutorunDetailView } from "@/ui/views/autoruns/autorun-detail"
import { AutorunsListView } from "@/ui/views/autoruns/autoruns-list"
import { LoginView } from "@/ui/views/auth/login-view"
import { NotFoundView } from "@/ui/views/auth/not-found-view"
import { RegisterView } from "@/ui/views/auth/register-view"
import { ImportExportView } from "@/ui/views/import-export/import-export-view"
import { PluginsView } from "@/ui/views/plugins/plugins-view"
import { ProfilesView } from "@/ui/views/profiles/profiles-view"
import { RecordingsView } from "@/ui/views/recordings/recordings-view"
import { SessionDetailView } from "@/ui/views/sessions/session-detail"
import { SessionsListView } from "@/ui/views/sessions/sessions-list"
import { SettingsView } from "@/ui/views/settings/settings-view"

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundView,
  beforeLoad: async () => {
    if (getAuthState().status !== "unknown") return
    try {
      await ensureAuthMe()
    } catch {
      // Anonymous — the app guard redirects to /login.
    }
  },
})

const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: () => {
    if (getAuthState().status === "authenticated") throw redirect({ to: "/sessions" })
  },
  component: () => <Outlet />,
})

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: () => {
    if (getAuthState().status !== "authenticated") throw redirect({ to: "/login" })
  },
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" })
  },
})

const loginRoute = createRoute({ getParentRoute: () => publicLayout, path: "/login", component: LoginView })
const registerRoute = createRoute({ getParentRoute: () => publicLayout, path: "/register", component: RegisterView })

const sessionsRoute = createRoute({ getParentRoute: () => appLayout, path: "/sessions", component: SessionsListView })

const sessionDetailRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/sessions/$sessionId",
  component: SessionDetailRoute,
})
function SessionDetailRoute() {
  const { sessionId } = sessionDetailRoute.useParams()
  return <SessionDetailView sessionId={sessionId} />
}

const autorunsRoute = createRoute({ getParentRoute: () => appLayout, path: "/autoruns", component: AutorunsListView })

const autorunDetailRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/autoruns/$autorunId",
  component: AutorunDetailRoute,
})
function AutorunDetailRoute() {
  const { autorunId } = autorunDetailRoute.useParams()
  return <AutorunDetailView autorunId={autorunId} />
}

const recordingsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/recordings",
  validateSearch: (search: Record<string, unknown>): { highlight?: number } => {
    const raw = search.highlight
    const parsed =
      typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) ? { highlight: parsed } : {}
  },
  component: RecordingsRoute,
})
function RecordingsRoute() {
  const { highlight } = recordingsRoute.useSearch()
  return <RecordingsView highlight={highlight} />
}

const profilesRoute = createRoute({ getParentRoute: () => appLayout, path: "/profiles", component: ProfilesView })
const pluginsRoute = createRoute({ getParentRoute: () => appLayout, path: "/plugins", component: PluginsView })
const importExportRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/import-export",
  component: ImportExportView,
})
const settingsRoute = createRoute({ getParentRoute: () => appLayout, path: "/settings", component: SettingsView })

export const routeTree = rootRoute.addChildren([
  indexRoute,
  publicLayout.addChildren([loginRoute, registerRoute]),
  appLayout.addChildren([
    sessionsRoute,
    sessionDetailRoute,
    autorunsRoute,
    autorunDetailRoute,
    recordingsRoute,
    profilesRoute,
    pluginsRoute,
    importExportRoute,
    settingsRoute,
  ]),
])
