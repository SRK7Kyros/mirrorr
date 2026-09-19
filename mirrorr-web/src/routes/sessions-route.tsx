import { createRoute } from "@tanstack/react-router"
import { TokenProbe } from "@/components/dev/TokenProbe"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * Temporary Sessions home (default landing, spec L37). The real V3 view lands
 * in Wave 2; TokenProbe rides here until then so the token e2e specs keep a
 * reachable mount point.
 */
export const sessionsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions",
  component: SessionsPlaceholder,
})

function SessionsPlaceholder() {
  return (
    <main
      data-testid="sessions-placeholder"
      className="grid min-h-dvh place-items-center bg-bg-base p-6"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <h1 className="text-heading font-semibold tracking-tight text-text-primary">Sessions</h1>
        <p className="text-body text-text-secondary">This view arrives in a later step.</p>
        <TokenProbe />
      </div>
    </main>
  )
}
