import { Link } from "@tanstack/react-router"

export function NotFoundView() {
  return (
    <main data-testid="not-found" className="grid min-h-dvh place-items-center bg-bg-base p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-heading font-semibold tracking-tight text-text-primary">
          Page not found
        </h1>
        <p className="text-body text-text-secondary">That route does not exist or has moved.</p>
        <Link to="/" className="text-body font-medium text-accent hover:text-accent-hover">
          Go home
        </Link>
      </div>
    </main>
  )
}
