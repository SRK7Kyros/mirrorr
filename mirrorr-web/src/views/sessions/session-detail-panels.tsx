import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { subscribeRemuxProgress, type RemuxProgress } from "@/lib/event-table"
import type { Session } from "@/lib/schemas"
import { formatDateTime, formatDuration, formatRelativeTime } from "@/lib/time"
import { getStatusDescriptor } from "@/lib/status-map"
import {
  CopyButton,
  JsonWell,
  RecordingCell,
  RouteLink,
  statusChipProps,
} from "@/views/shared/parts"
import { StatusChip } from "@/components/ui/StatusChip"

export function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card card-stack">
      <h2 className="card__title">{title}</h2>
      {children}
    </section>
  )
}

/** Live URLs panel — labeled rows (M3U8/HTML/Outplayer) + copy + external open. */
export function LiveUrlsPanel({ session }: { session: Session }) {
  const urls = session.session_urls ?? []
  if (urls.length === 0) {
    return (
      <PanelCard title="Live URLs">
        <p className="t-body view-subtitle">
          Live URLs unavailable — the operator must set `web_url` on the server
        </p>
      </PanelCard>
    )
  }
  return (
    <PanelCard title="Live URLs">
      {urls.map((entry, index) => {
        const label = entry.label ?? entry.name ?? entry.type ?? `Link ${index + 1}`
        const url = entry.url ?? entry.href ?? ""
        return (
          <div key={`${label}-${index}`} className="url-row">
            <span className="url-row__label">{label}</span>
            <span className="url-row__value t-mono wrap-anywhere">{url}</span>
            <CopyButton text={url} label={`Copy ${label} URL`} />
            <a className="btn btn--ghost" href={url} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </div>
        )
      })}
    </PanelCard>
  )
}

interface AttemptRow {
  readonly index: number
  readonly status: string
  readonly started: string | null
  readonly ended: string | null
  readonly exitCode: unknown
  readonly error: string | null
}

function toAttemptRow(raw: Record<string, unknown>, index: number): AttemptRow {
  const started = typeof raw.started_at === "string" ? raw.started_at : null
  const ended = typeof raw.ended_at === "string" ? raw.ended_at : null
  const exit = raw.exit_code
  const errorRaw = raw.error ?? raw.reason ?? raw.detail
  return {
    index: typeof raw.index === "number" ? raw.index : index,
    status: typeof raw.status === "string" ? raw.status : "unknown",
    started,
    ended,
    exitCode: exit,
    error: typeof errorRaw === "string" ? errorRaw : null,
  }
}

/** Attempts timeline (36px rows) + "retry N" header counter. */
export function AttemptsPanel({ session }: { session: Session }) {
  const attempts = (session.attempts ?? []).map((raw, index) => toAttemptRow(raw, index))
  const retries = session.retry_attempts ?? Math.max(0, attempts.length - 1)
  return (
    <PanelCard title={`Attempts — retry ${retries}`}>
      {attempts.length === 0 ? (
        <p className="t-body view-subtitle">No attempts recorded</p>
      ) : (
        attempts.map((attempt) => {
          const chip = statusChipProps(attempt.status)
          const descriptor = getStatusDescriptor(attempt.status)
          return (
            <div key={attempt.index} className="timeline-row">
              <span className="t-mono-inline">{`#${attempt.index}`}</span>
              <StatusChip status={chip.status} title={chip.title} compact />
              <span className="t-meta">
                {attempt.started == null ? "—" : formatDateTime(attempt.started)}
                {" → "}
                {attempt.ended == null ? "…" : formatDateTime(attempt.ended)}
              </span>
              {attempt.exitCode === undefined || attempt.exitCode === null ? null : (
                <span className="t-mono-inline">{`exit ${String(attempt.exitCode)}`}</span>
              )}
              {descriptor.icon !== undefined ? null : null}
              {attempt.error === null ? null : (
                <span className="timeline-row__error">{attempt.error}</span>
              )}
            </div>
          )
        })
      )}
    </PanelCard>
  )
}

/** Config card — read-only JSON wells for resolver + retry config. */
export function ConfigPanel({ session }: { session: Session }) {
  return (
    <PanelCard title="Config">
      <JsonWell label="Resolver config" value={session.resolver_config ?? {}} />
      <JsonWell
        label="Retry"
        value={{
          mode: session.retry_mode ?? null,
          params: session.retry_config ?? {},
        }}
      />
    </PanelCard>
  )
}

/** Recording flag card (aside). */
export function RecordingPanel({
  session,
  canRecord,
  children,
}: {
  session: Session
  canRecord: boolean
  children?: ReactNode
}) {
  return (
    <PanelCard title="Recording">
      <RecordingCell recording={session.recording} canRecord={canRecord} />
      {children}
    </PanelCard>
  )
}

const REMUX_STALE_MS = 10_000

/**
 * Remux progress card — visible only while `status === "remuxing"`. Progress
 * frames arrive via subscribeRemuxProgress (NOT cached); 10s without a frame
 * → indeterminate 30% shuttle.
 */
export function RemuxPanel({ session }: { session: Session }) {
  const [progress, setProgress] = useState<RemuxProgress | null>(null)
  const [stale, setStale] = useState(false)
  const remuxing = session.status === "remuxing"

  useEffect(() => {
    if (!remuxing) return
    setProgress(null)
    setStale(false)
    const unsubscribe = subscribeRemuxProgress(session.id, (next) => {
      setProgress(next)
      setStale(false)
    })
    const timer = setTimeout(() => setStale(true), REMUX_STALE_MS)
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [remuxing, session.id])

  useEffect(() => {
    if (!remuxing || progress === null) return
    setStale(false)
    const timer = setTimeout(() => setStale(true), REMUX_STALE_MS)
    return () => clearTimeout(timer)
  }, [progress, remuxing])

  if (!remuxing) return null

  const percent = progress?.percent ?? 0
  const indeterminate = stale || progress === null
  const scale = indeterminate ? 0.3 : Math.max(0, Math.min(100, percent)) / 100

  return (
    <PanelCard title="Remux progress">
      <div className={indeterminate ? "remux remux--indeterminate" : "remux"}>
        <span className="remux__percent num">{indeterminate ? "—" : `${percent.toFixed(0)}%`}</span>
        <div className="remux__track">
          <div
            className="remux__fill"
            style={indeterminate ? undefined : { transform: `scaleX(${scale})`, width: "100%" }}
          />
        </div>
        <span className="t-meta num">
          {progress?.eta_seconds != null ? `eta ${formatDuration(Math.round(progress.eta_seconds))}` : ""}
          {progress?.speed != null ? ` · ${progress.speed.toFixed(1)}x` : ""}
        </span>
      </div>
    </PanelCard>
  )
}

/** Mini status line used by V6 linked-session card. */
export function SessionStatusLine({ session }: { session: Session }) {
  const chip = statusChipProps(session.status)
  return (
    <span className="cluster">
      <StatusChip status={chip.status} title={chip.title} compact />
      <span className="t-mono-inline">{`#${session.id}`}</span>
      <span className="t-meta">
        {session.started_at == null ? "—" : formatRelativeTime(session.started_at)}
      </span>
      <RouteLink to="/sessions/$sessionId" params={{ sessionId: String(session.id) }} className="t-body">
        Open session
      </RouteLink>
    </span>
  )
}
