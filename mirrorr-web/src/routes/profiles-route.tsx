import { createRoute } from "@tanstack/react-router"
import { ProfilesView } from "@/components/profiles/ProfilesView"
import { parseHighlightSearch } from "@/hooks/use-highlight"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export interface ProfilesSearch {
  readonly highlight?: number
}

export const profilesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/profiles",
  validateSearch: (search: Record<string, unknown>): ProfilesSearch => ({
    highlight: parseHighlightSearch(search.highlight),
  }),
  component: ProfilesRouteComponent,
})

function ProfilesRouteComponent() {
  const search = profilesRoute.useSearch()
  return <ProfilesView highlight={search.highlight ?? null} />
}
