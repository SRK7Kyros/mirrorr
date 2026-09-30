import { createRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { authLayoutRoute } from "@/routes/auth-layout-route"

const RecordingsGrid = lazy(() =>
  import("@/views/recordings/recordings-grid").then((m) => ({ default: m.RecordingsGrid })),
)

export interface RecordingsSearch {
  readonly highlight?: number
}

export const recordingsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/recordings",
  validateSearch: (search: Record<string, unknown>): RecordingsSearch => {
    const raw = search.highlight
    const parsed = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN
    return { highlight: Number.isFinite(parsed) ? parsed : undefined }
  },
  component: RecordingsRouteView,
})

function RecordingsRouteView() {
  return (
    <Suspense fallback={null}>
      <RecordingsGrid />
    </Suspense>
  )
}
