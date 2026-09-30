import { createRoute } from "@tanstack/react-router"
import { AutorunDetailView } from "@/components/autoruns/AutorunDetailView"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { authLayoutRoute } from "@/routes/auth-layout-route"

export const autorunDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/autoruns/$autorunId",
  component: AutorunDetailRouteComponent,
})

function AutorunDetailRouteComponent() {
  const { autorunId } = autorunDetailRoute.useParams()
  const id = Number.parseInt(autorunId, 10)

  if (!Number.isFinite(id)) {
    return (
      <main className="flex flex-col gap-4">
        <ErrorPanel message="Invalid autorun id" />
      </main>
    )
  }

  return <AutorunDetailView autorunId={id} />
}
