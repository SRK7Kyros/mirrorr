import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/Button"

/**
 * ErrorPanel — one implementation for every view's failure state (spec L408),
 * with the standard retry affordance. `role="alert"` so a panel that replaces
 * a loading list is announced.
 */

export const ERROR_PANEL_TITLE = "Something went wrong"
export const ERROR_PANEL_RETRY_LABEL = "Retry"

export interface ErrorPanelProps {
  readonly message: string
  readonly title?: string
  readonly onRetry?: () => void
}

export function ErrorPanel({ message, title = ERROR_PANEL_TITLE, onRetry }: ErrorPanelProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-surface border border-border bg-bg-raised px-6 py-8 text-center"
    >
      <AlertTriangle
        aria-hidden="true"
        strokeWidth={2}
        className="size-[var(--icon-empty)] text-danger"
      />
      <p className="text-title font-semibold text-text-primary">{title}</p>
      <p className="max-w-prose text-body text-text-secondary">{message}</p>
      {onRetry !== undefined ? (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          {ERROR_PANEL_RETRY_LABEL}
        </Button>
      ) : null}
    </div>
  )
}
