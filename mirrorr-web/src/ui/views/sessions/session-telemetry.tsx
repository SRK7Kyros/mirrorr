import { useEffect, useState } from "react"
import { subscribeSessionTelemetry, type SessionTelemetry } from "@/api"
import { formatBytes } from "@/api/time"

function usageLine(cpu: number | undefined, rss: number | undefined): string {
  const parts: string[] = []
  if (cpu !== undefined) parts.push(`${cpu.toFixed(1)}%`)
  if (rss !== undefined) parts.push(formatBytes(rss))
  return parts.join(" · ")
}

/** Live per-process CPU/RSS of the running attempt (core `session.<id>.telemetry`). */
export function SessionTelemetryReadout({
  sessionId,
  className,
}: {
  readonly sessionId: number
  readonly className?: string
}) {
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null)

  useEffect(() => {
    setTelemetry(null)
    return subscribeSessionTelemetry(sessionId, setTelemetry)
  }, [sessionId])

  if (telemetry === null) return null

  return (
    <div className={className} data-slot="session-telemetry">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.05em] text-ink-dim">Process usage</span>
          {telemetry.total_rss_bytes !== undefined ? (
            <span className="tnum text-xs text-dim">RSS {formatBytes(telemetry.total_rss_bytes)}</span>
          ) : null}
        </div>
        {telemetry.processes.map((process, index) => (
          <div
            key={`${process.name}-${index}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="mono">{process.name}</span>
            <span className="tnum text-dim">
              {usageLine(process.cpu_percent, process.rss_bytes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
