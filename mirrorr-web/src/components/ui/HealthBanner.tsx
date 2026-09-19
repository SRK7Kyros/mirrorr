import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/Button"

/**
 * HealthBanner — spec L407: a top amber banner for `GET /health` failure
 * ("API unreachable — retrying") or the WS polling fallback ("Live updates
 * offline — polling every 15s", spec L171) with a manual Retry.
 */

export const HEALTH_BANNER_COPY = {
  api: "API unreachable — retrying",
  socket: "Live updates offline — polling every 15s",
} as const

export type HealthBannerVariant = keyof typeof HEALTH_BANNER_COPY

export interface HealthBannerProps {
  readonly variant?: HealthBannerVariant
  readonly onRetry?: () => void
  readonly className?: string
}

export function HealthBanner({ variant = "api", onRetry, className }: HealthBannerProps) {
  return (
    <div
      role="status"
      className={[
        "flex w-full items-center justify-center gap-2 border-b border-warn/30 bg-warn/12 px-3 py-2 text-small text-warn",
        className ?? "",
      ].join(" ")}
    >
      <AlertTriangle
        aria-hidden="true"
        strokeWidth={2}
        className="size-[var(--icon-default)] shrink-0"
      />
      <span>{HEALTH_BANNER_COPY[variant]}</span>
      {onRetry !== undefined ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
