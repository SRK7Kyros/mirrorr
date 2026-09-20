import { createRoute } from "@tanstack/react-router"
import { RecordingsView } from "@/components/recordings/RecordingsView"
import { parseHighlightSearch } from "@/hooks/use-highlight"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export interface RecordingsSearch {
  readonly highlight?: number
}

export const recordingsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/recordings",
  validateSearch: (search: Record<string, unknown>): RecordingsSearch => ({
    highlight: parseHighlightSearch(search.highlight),
  }),
  component: RecordingsRouteComponent,
})

function RecordingsRouteComponent() {
  const search = recordingsRoute.useSearch()
  return <RecordingsView highlight={search.highlight ?? null} />
}
