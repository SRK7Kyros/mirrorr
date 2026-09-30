import type { ReactNode } from "react"

export interface HealthBannerProps {
  readonly tone: "degraded" | "api-client"
  readonly message?: string
  readonly action?: ReactNode
}

const DEFAULT_MESSAGES: Readonly<Record<HealthBannerProps["tone"], string>> = {
  degraded: "Mirrorr can't reach the backend right now. Views may be stale or empty.",
  "api-client": "You're using an API-client auth flow.",
}

/**
 * HealthBanner — §4/§6: edge-to-edge strip under the top bar (rows 1/2 of
 * the shell grid). Degraded = amber (bg 12% `#f59e0b`, fg `#FBBF24`,
 * border 35%, min-h 36, 12/500); API-client = neutral system note on
 * fill-hover. role="status" so live-region wording is announced (§7).
 */
export function HealthBanner({ tone, message, action }: HealthBannerProps) {
  const classes = tone === "api-client" ? "health-banner health-banner--neutral" : "health-banner"

  return (
    <div role="status" className={classes}>
      <span>{message ?? DEFAULT_MESSAGES[tone]}</span>
      {action}
    </div>
  )
}
