import { useEffect, useState } from "react"
import { subscribeRemuxProgress, type RemuxProgress } from "@/api"
import { formatDuration } from "@/api/time"
import { Progress } from "@/ui/components"

/**
 * Determinate remux bar for a `remuxing` row/panel. The percentage only ever
 * comes from `session.{id}.remux.progress` frames (spec §1.4 binding rule) —
 * the status alone never fabricates one, and nothing renders until the first
 * frame arrives.
 */
export function RemuxProgressBar({
  sessionId,
  className,
}: {
  readonly sessionId: number
  readonly className?: string
}) {
  const [progress, setProgress] = useState<RemuxProgress | null>(null)

  useEffect(() => {
    setProgress(null)
    return subscribeRemuxProgress(sessionId, setProgress)
  }, [sessionId])

  if (progress === null) return null

  const details: string[] = [`${Math.round(progress.percent)}%`]
  if (progress.eta_seconds !== undefined) details.push(`ETA ${formatDuration(Math.round(progress.eta_seconds))}`)
  if (progress.speed !== undefined) details.push(`${progress.speed.toFixed(2)}×`)

  return (
    <div className={className}>
      <Progress value={progress.percent} max={100} label={`Remux progress for session #${sessionId}`} />
      <span className="text-dim tnum" style={{ fontSize: "var(--fs-sm)" }}>
        {details.join(" · ")}
      </span>
    </div>
  )
}
