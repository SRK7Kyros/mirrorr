import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const ProfilesView = lazy(() =>
  import("@/views/profiles/profiles").then((m) => ({ default: m.ProfilesView })),
)

export interface ProfilesSearch {
  readonly highlight?: number
}

export const profilesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/profiles",
  validateSearch: (search: Record<string, unknown>): ProfilesSearch => {
    const raw = search.highlight
    const parsed = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN
    return { highlight: Number.isFinite(parsed) ? parsed : undefined }
  },
  component: ProfilesRouteView,
})

function ProfilesRouteView() {
  return (
    <Suspense fallback={null}>
      <ProfilesView />
    </Suspense>
  )
}
