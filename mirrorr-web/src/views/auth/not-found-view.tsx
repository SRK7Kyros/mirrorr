import { useNavigate, useRouterState } from "@tanstack/react-router"
import { Button } from "@/components/ui/Button"
import "@/styles/views-admin.css"

/**
 * §5.12 Not-found. Route-level fallback — a resource 404 inside a valid route
 * renders that view's own error state instead. Content-only (the shell stays
 * whatever the router put around it).
 */
export function NotFoundView() {
  const navigate = useNavigate()
  const path = useRouterState({ select: (state) => state.location.pathname })

  return (
    <div className="notfound-wrap">
      <section className="panel opaque notfound" aria-labelledby="notfound-title">
        <p className="t-label-caps">404</p>
        <h1 id="notfound-title" className="t-h2">
          No console at this address.
        </h1>
        <p className="notfound__path t-mono" title={path}>
          {path}
        </p>
        <Button variant="primary" onClick={() => void navigate({ to: "/sessions" })}>
          Back to sessions
        </Button>
      </section>
    </div>
  )
}
