import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * `/settings` — V11 shell (tab list) with three children:
 *   `/`         → Account (V11)
 *   `/users`    → Users (V12, admin-gated in-component)
 *   `/clients`  → API clients (V13, admin-gated in-component)
 * Orchestrator wires `settingsRoute` into router.tsx — DO NOT edit it here.
 * Admin gating is component-level (EmptyState): a typed beforeLoad
 * `redirect({to:"/settings"})` cannot typecheck until the route tree
 * contains these paths.
 */

const SettingsView = lazy(() =>
  import("@/views/settings/settings-view").then((m) => ({ default: m.SettingsView })),
)
const AccountSection = lazy(() =>
  import("@/views/settings/account-section").then((m) => ({ default: m.AccountSection })),
)
const UsersSection = lazy(() =>
  import("@/views/settings/users-section").then((m) => ({ default: m.UsersSection })),
)
const ClientsSection = lazy(() =>
  import("@/views/settings/clients-section").then((m) => ({ default: m.ClientsSection })),
)

function SettingsShellRouteView() {
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  )
}

function SettingsIndexRouteView() {
  return (
    <Suspense fallback={null}>
      <AccountSection />
    </Suspense>
  )
}

function SettingsUsersRouteView() {
  return (
    <Suspense fallback={null}>
      <UsersSection />
    </Suspense>
  )
}

function SettingsClientsRouteView() {
  return (
    <Suspense fallback={null}>
      <ClientsSection />
    </Suspense>
  )
}

const settingsParentRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings",
  component: SettingsShellRouteView,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: "/",
  component: SettingsIndexRouteView,
})

const settingsUsersRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: "users",
  component: SettingsUsersRouteView,
})

const settingsClientsRoute = createRoute({
  getParentRoute: () => settingsParentRoute,
  path: "clients",
  component: SettingsClientsRouteView,
})

export const settingsRoute = settingsParentRoute.addChildren([
  settingsIndexRoute,
  settingsUsersRoute,
  settingsClientsRoute,
])
