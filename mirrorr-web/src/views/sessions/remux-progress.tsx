import { useEffect, useState } from "react"
import { subscribeRemuxProgress, type RemuxProgress } from "@/lib/event-table"
import type { Session } from "@/lib/schemas"

/** §11.25 — progress frames stop arriving after ~10s → indeterminate shuttle. */
const REMUX_STALE_MS = 10_000

export interface RemuxState {
  readonly progress: RemuxProgress | null
  readonly indeterminate: boolean
  readonly percent: number
}

/**
 * Subscribes to the remux progress channel for a session while it is remuxing.
 * Progress frames are transient (never cached) and reconciled only against
 * the authoritative `status`; a 10s gap flips to indeterminate.
 */
export function useRemuxProgress(sessionId: number, active: boolean): RemuxState {
  const [progress, setProgress] = useState<RemuxProgress | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (!active) {
      setProgress(null)
      setStale(false)
      return
    }
    setProgress(null)
    setStale(false)
    const unsubscribe = subscribeRemuxProgress(sessionId, (next) => {
      setProgress(next)
      setStale(false)
    })
    const timer = setTimeout(() => setStale(true), REMUX_STALE_MS)
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [active, sessionId])

  const indeterminate = progress === null || stale
  return { progress, indeterminate, percent: progress?.percent ?? 0 }
}

/** Determinate/indeterminate remux bar (list rows + detail panel). */
export function RemuxBar({ session }: { readonly session: Session }) {
  const { progress, indeterminate, percent } = useRemuxProgress(session.id, session.status === "remuxing")

  if (session.status !== "remuxing") return null

  const scale = Math.max(0, Math.min(100, percent)) / 100
  const eta = progress?.eta_seconds == null ? null : `${Math.round(progress.eta_seconds)}s`
  const speed = progress?.speed == null ? null : `${progress.speed.toFixed(1)}x`

  return (
    <div className={indeterminate ? "ve-remux ve-remux--indeterminate" : "ve-remux"}>
      <span className="ve-remux__value">{indeterminate ? "—" : `${percent.toFixed(0)}%`}</span>
      <div
        className="ve-remux__track"
        role="progressbar"
        aria-label="Remux progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        aria-valuetext={indeterminate ? "Remuxing, progress unknown" : `${Math.round(percent)} percent`}
      >
        <div
          className="ve-remux__fill"
          style={indeterminate ? undefined : { transform: `scaleX(${scale})` }}
        />
      </div>
      <span className="ve-remux__value">
        {[eta, speed].filter((part): part is string => part !== null).join(" · ")}
      </span>
    </div>
  )
}
