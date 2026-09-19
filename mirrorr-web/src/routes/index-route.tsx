import { createRoute } from "@tanstack/react-router"
import { TokenProbe } from "@/components/dev/TokenProbe"
import { rootRoute } from "@/routes/root-route"

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPlaceholder,
})

function IndexPlaceholder() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <h1 className="text-display font-semibold tracking-tight text-text-primary">Mirrorr</h1>
        <p className="text-body text-text-secondary">Client scaffold online.</p>
        <TokenProbe />
      </div>
    </main>
  )
}
