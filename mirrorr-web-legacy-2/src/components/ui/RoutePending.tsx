import { Loader2 } from "lucide-react"

export function RoutePending() {
  return (
    <main
      data-testid="route-pending"
      aria-busy="true"
      className="grid min-h-dvh place-items-center bg-bg-base"
    >
      <span className="flex items-center gap-2 text-small text-text-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Loading
      </span>
    </main>
  )
}
