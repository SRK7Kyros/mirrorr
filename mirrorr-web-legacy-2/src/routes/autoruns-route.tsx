import { createRoute } from "@tanstack/react-router"
import { AutorunsView } from "@/components/autoruns/AutorunsView"
import { DEFAULT_AUTORUN_FILTER } from "@/lib/autorun-filters"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export interface AutorunsSearch {
  readonly filter?: string
}

export const autorunsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/autoruns",
  validateSearch: (search: Record<string, unknown>): AutorunsSearch => ({
    filter: typeof search.filter === "string" && search.filter.length > 0 ? search.filter : undefined,
  }),
  component: AutorunsRouteComponent,
})

function AutorunsRouteComponent() {
  const search = autorunsRoute.useSearch()
  const navigate = autorunsRoute.useNavigate()

  return (
    <AutorunsView
      filter={search.filter ?? DEFAULT_AUTORUN_FILTER}
      onFilterChange={(next) => void navigate({ search: { filter: next } })}
    />
  )
}
