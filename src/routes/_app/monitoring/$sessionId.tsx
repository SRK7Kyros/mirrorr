/**
 * @module routes/_app/monitoring/$sessionId
 *
 * Per-session telemetry detail page.
 * Shows historical CPU%, memory, and process count charts for a session.
 */
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { telemetryApi, sessionsApi } from "@/lib/api"
import { StatusBadge } from "@/components/status-badge"
import { TelemetryCharts } from "@/components/telemetry-charts"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { formatDuration } from "@/lib/utils"
import { AREAS, MONITORING_SESSION } from "@/lib/layouts"

export const Route = createFileRoute("/_app/monitoring/$sessionId")({
  component: SessionTelemetryPage,
})

function SessionTelemetryPage() {
  const { sessionId } = Route.useParams()
  const sessionIdNum = parseInt(sessionId, 10)

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["sessions", sessionIdNum],
    queryFn: () => sessionsApi.get(sessionIdNum),
  })

  const { data: samples = [], isLoading: samplesLoading } = useQuery({
    queryKey: ["telemetry-session", sessionIdNum],
    queryFn: () => telemetryApi.sessionSamples(sessionIdNum),
    refetchInterval: 5000,
  })

  const isLoading = sessionLoading || samplesLoading

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Link to="/monitoring">
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <ArrowLeft className="size-3 mr-1" />Back
          </Button>
        </Link>
      </div>
    )
  }

  const sessionData = session as Record<string, unknown>

  return (
    <div className="h-full grid" style={MONITORING_SESSION.style}>
      <div className="shrink-0 px-5 pt-5 pb-3 border-b" style={{ gridArea: AREAS.header }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/monitoring">
              <Button variant="ghost" size="sm" className="h-6 text-xs">
                <ArrowLeft className="size-3 mr-0.5" />Back
              </Button>
            </Link>
            <h2 className="text-sm font-bold">Session #{sessionData.id as number}</h2>
            <StatusBadge status={sessionData.status as string} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {sessionData.duration_seconds != null && (sessionData.duration_seconds as number) > 0 && (
              <span>Duration: {formatDuration(sessionData.duration_seconds as number)}</span>
            )}
            <span>{(samples as unknown[]).length} samples</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" style={{ gridArea: AREAS.charts }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : (samples as unknown[]).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2">
            <p>No telemetry data for this session</p>
            <p className="text-muted-foreground/60">Telemetry is recorded for active and recording sessions</p>
          </div>
        ) : (
          <TelemetryCharts samples={samples as unknown as import("@/lib/schemas").TelemetrySample[]} className="space-y-4" />
        )}
      </div>
    </div>
  )
}
