import { createRoute } from "@tanstack/react-router"
import { rootRoute } from "@/routes/root-route"

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPlaceholder,
})

function IndexPlaceholder() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Mirrorr</h1>
        <p className="mt-2 text-sm text-zinc-400">Client scaffold online.</p>
      </div>
    </main>
  )
}
