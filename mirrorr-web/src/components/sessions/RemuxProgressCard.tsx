/**
 * V4 — the remux progress card (spec L181-L185, L193).
 *
 * Renders the latest `session.{id}.remux.progress` percent as a determinate
 * bar. When no frame has arrived within `REMUX_INDETERMINATE_AFTER_MS` (10s)
 * and the engine is still streaming, the card swaps to an indeterminate bar —
 * a stuck-looking 0% is worse than an honest "unknown". The card is only
 * mounted while the session status is `remuxing`.
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import {
  getRemuxProgress,
  REMUX_INDETERMINATE_AFTER_MS,
  subscribeRemuxProgress,
} from "@/lib/remux-progress"

export interface RemuxProgressCardProps {
  sessionId: number
}

function formatEta(etaSeconds: number | undefined): string | null {
  if (etaSeconds === undefined || etaSeconds < 0) return null
  const totalSeconds = Math.round(etaSeconds)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `~${seconds}s left`
  return `~${minutes}m ${String(seconds).padStart(2, "0")}s left`
}

export function RemuxProgressCard({ sessionId }: RemuxProgressCardProps) {
  const progress = useSyncExternalStore(subscribeRemuxProgress, () =>
    getRemuxProgress(sessionId),
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const indeterminate =
    progress === null || now - progress.receivedAt >= REMUX_INDETERMINATE_AFTER_MS
  const percent = progress === null ? 0 : Math.round(progress.percent)
  const eta = progress === null ? null : formatEta(progress.etaSeconds)

  return (
    <section
      data-testid="remux-progress-card"
      data-mode={indeterminate ? "indeterminate" : "determinate"}
      className="rounded-surface border border-border bg-bg-raised p-4"
    >
      <h2 className="text-label font-medium text-text-secondary">Remux progress</h2>

      <div
        data-testid="remux-progress-track"
        role="progressbar"
        aria-label="Remux progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        className="mt-3 h-2 overflow-hidden rounded-pill bg-bg-inset"
      >
        {indeterminate ? (
          <div
            data-testid="remux-progress-indeterminate"
            className="h-full w-1/3 animate-pulse-recording bg-accent"
          />
        ) : (
          <div
            data-testid="remux-progress-bar"
            className="h-full bg-accent"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>

      <p data-testid="remux-progress-label" className="mt-2 text-small text-text-secondary">
        {indeterminate ? (
          "Estimating progress…"
        ) : (
          <>
            {percent}%{eta === null ? null : ` · ${eta}`}
            {progress?.speed === undefined ? null : ` · ${progress.speed}`}
          </>
        )}
      </p>
    </section>
  )
}
