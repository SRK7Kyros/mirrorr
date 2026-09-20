import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { assertApiConfig } from "@/config/env"
import { startProactiveRefresh } from "@/lib/api"
import { installAuthSession } from "@/lib/auth-store"
import { entityStore } from "@/lib/entity-store-client"
import { installEventTable } from "@/lib/event-table"
import { nameMapStore } from "@/lib/name-map-api"
import { installNotificationFrameBridge } from "@/lib/notification-policy"
import { startRealtimeManager } from "@/lib/realtime-manager"
import { queryClient } from "@/query-client"
import { router } from "@/router"
import "@/styles.css"

// Boot guard: a missing or malformed VITE_API_URL must fail before any request.
assertApiConfig()

// The forced-logout consequence (cache wipe, session-expired state, /login)
// needs the live router; `api.ts` only detects the trigger.
installAuthSession({
  navigateToLogin: (redirectPath) => {
    void router.navigate({ to: "/login", search: { redirect: redirectPath } })
  },
  getCurrentHref: () => router.state.location.href,
})

startProactiveRefresh()

// Spec L165-L181: the /ws/events subject table + 30ms coalescing buffer.
installEventTable({
  store: entityStore,
  queryClient,
  navigate: (path) => {
    void router.navigate({ to: path })
  },
  isDetailOpen: (resource, id) =>
    router.state.location.pathname === (resource === "session" ? `/sessions/${id}` : `/autoruns/${id}`),
  invalidateNamesForEvent: (eventType) => nameMapStore.invalidateForEvent(eventType),
})

// Watches the auth store; connects only after the first successful /auth/me.
startRealtimeManager()

// Dev/e2e seam: lets a synthetic notification frame exercise the toast policy
// until the realtime socket lands (todo 18). Production builds drop this.
if (import.meta.env.DEV) {
  installNotificationFrameBridge()
}

const container = document.getElementById("root")

if (!container) {
  throw new Error("Mirrorr web root element #root is missing from the document")
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
