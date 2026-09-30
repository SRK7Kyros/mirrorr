import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const AutorunsList = lazy(() =>
  import("@/views/autoruns/autoruns-list").then((m) => ({ default: m.AutorunsList })),
)

export interface AutorunsSearch {
  readonly filter?: string
}

export const autorunsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/autoruns",
  validateSearch: (search: Record<string, unknown>): AutorunsSearch => ({
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
  component: AutorunsRouteView,
})

function AutorunsRouteView() {
  return (
    <Suspense fallback={null}>
      <AutorunsList />
    </Suspense>
  )
}
