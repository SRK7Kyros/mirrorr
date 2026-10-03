import type { ReactNode } from "react"
import { StatusChip } from "@/components/ui/StatusChip"
import type { Session } from "@/lib/schemas"
import { formatDateTime } from "@/lib/time"
import { resolveEntityName } from "@/lib/query-keys"
import {
  CopyButton,
  JsonWell,
  RecordingCell,
  RouteLink,
  statusChipProps,
  sessionTitle,
} from "@/views/shared/parts"
import { formatDuration } from "@/lib/time"
import { useLiveDurationSeconds, type NameMaps } from "@/views/shared/hooks"

/** Opaque reading panel (spec §2: detail panes are never acrylic). */
export function PanelCard({
  title,
  count,
  actions,
  children,
}: {
  title: string
  count?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="opaque panel ve-panel">
      <header className="ve-panel__head">
        <h2 className="ve-panel__title">{title}</h2>
        <span className="ve-inline">
          {count !== undefined ? <span className="ve-panel__count">{count}</span> : null}
          {actions}
        </span>
      </header>
      <div className="ve-panel__body">{children}</div>
    </section>
  )
}

/** Live duration readout (1s tick while the session runs). */
export function LiveDuration({
  startedAt,
  endedAt,
}: {
  readonly startedAt: string | null | undefined
  readonly endedAt: string | null | undefined
}) {
  const seconds = useLiveDurationSeconds(startedAt, endedAt)
  return (
    <span className="t-mono num" aria-label="Duration">
      {seconds === null ? "—" : formatDuration(seconds)}
    </span>
  )
}

/**
 * §5.4(4) — live sources. `session_urls: []` is a first-class state (the
 * operator has not set `web_url`): explain it and disable the player
 * affordances rather than hang a spinner.
 */
export function LiveUrlsPanel({ session }: { readonly session: Session }) {
  const urls = session.session_urls ?? []

  if (urls.length === 0) {
    return (
      <PanelCard title="Live sources">
        <p className="ve-note">
          Live URLs not configured (operator must set <code className="t-mono-inline">web_url</code>).
        </p>
        <div className="ve-inline">
          <a className="btn btn--secondary" aria-disabled="true" tabIndex={-1} href="#live-sources">
            <span className="btn__label">Player unavailable</span>
          </a>
        </div>
      </PanelCard>
    )
  }

  return (
    <PanelCard title="Live sources" count={`${urls.length}`}>
      {urls.map((entry, index) => {
        const label = entry.label ?? entry.name ?? entry.type ?? `Link ${index + 1}`
        const url = entry.url ?? entry.href ?? ""
        return (
          <div key={`${label}-${index}`} className="ve-url">
            <span className="ve-url__label">{label}</span>
            <span className="ve-url__value">{url}</span>
            <CopyButton text={url} label={`Copy ${label} URL`} />
            <a className="btn btn--secondary" href={url} target="_blank" rel="noreferrer">
              <span className="btn__label">Open</span>
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
  readonly reason: string | null
}

function toAttemptRow(raw: Record<string, unknown>, index: number): AttemptRow {
  const reasonRaw = raw.error ?? raw.reason ?? raw.detail
  return {
    index: typeof raw.index === "number" ? raw.index : index,
    status: typeof raw.status === "string" ? raw.status : "unknown",
    started: typeof raw.started_at === "string" ? raw.started_at : null,
    ended: typeof raw.ended_at === "string" ? raw.ended_at : null,
    exitCode: raw.exit_code,
    reason: typeof reasonRaw === "string" ? reasonRaw : null,
  }
}

/** §5.4(3) — attempts timeline (own scroll, newest first). */
export function AttemptsPanel({ session }: { readonly session: Session }) {
  const attempts = (session.attempts ?? [])
    .map((raw, index) => toAttemptRow(raw, index))
    .sort((a, b) => b.index - a.index)
  const retries = session.retry_attempts ?? Math.max(0, attempts.length - 1)
  const spawning =
    attempts.length === 0 &&
    (session.status === "active" || session.status === "recording" || session.status === "terminating")

  return (
    <PanelCard title="Attempts" count={`retry ${retries}`}>
      {attempts.length === 0 ? (
        <p className="ve-note">
          {spawning
            ? "Waiting for the supervisor — attempt 1 not started yet."
            : "No attempts recorded."}
        </p>
      ) : (
        <div className="ve-attempts">
          {attempts.map((attempt) => {
            const chip = statusChipProps(attempt.status)
            return (
              <div key={attempt.index} className="ve-attempt">
                <span className="ve-attempt__id">{`#${attempt.index}`}</span>
                <StatusChip status={chip.status} title={chip.title} compact />
                <span className="ve-attempt__times">
                  {attempt.started == null ? "—" : formatDateTime(attempt.started)}
                  {" → "}
                  {attempt.ended == null ? "…" : formatDateTime(attempt.ended)}
                  {attempt.exitCode === undefined || attempt.exitCode === null
                    ? ""
                    : ` · exit ${String(attempt.exitCode)}`}
                </span>
                <span className="ve-attempt__reason">{attempt.reason ?? ""}</span>
              </div>
            )
          })}
        </div>
      )}
    </PanelCard>
  )
}

/** §5.4(5) — config snapshot (engine, resolver, resolver/retry config). */
export function ConfigPanel({ session, names }: { readonly session: Session; readonly names: NameMaps }) {
  return (
    <PanelCard title="Config snapshot">
      <dl className="ve-kv">
        <dt className="ve-kv__label">Engine</dt>
        <dd className="ve-kv__value">
          {resolveEntityName(session.engine_name, names.engines, session.engine_id)}
        </dd>
        <dt className="ve-kv__label">Resolver</dt>
        <dd className="ve-kv__value">
          {resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)}
        </dd>
        <dt className="ve-kv__label">Retry mode</dt>
        <dd className="ve-kv__value t-mono num">{session.retry_mode ?? "—"}</dd>
      </dl>
      <JsonWell label="Resolver config" value={session.resolver_config ?? {}} />
      <JsonWell label="Retry config" value={session.retry_config ?? {}} />
    </PanelCard>
  )
}

/** Timeline / recording aside (started, ended, recording flag). */
export function TimelinePanel({ session, canRecord }: { readonly session: Session; readonly canRecord: boolean }) {
  return (
    <PanelCard title="Timeline">
      <dl className="ve-kv">
        <dt className="ve-kv__label">Started</dt>
        <dd className="ve-kv__value">
          {session.started_at == null || session.started_at === "" ? "—" : formatDateTime(session.started_at)}
        </dd>
        <dt className="ve-kv__label">Ended</dt>
        <dd className="ve-kv__value">
          {session.ended_at == null || session.ended_at === "" ? "—" : formatDateTime(session.ended_at)}
        </dd>
        <dt className="ve-kv__label">Recording</dt>
        <dd className="ve-kv__value">
          <RecordingCell recording={session.recording} canRecord={canRecord} />
        </dd>
      </dl>
    </PanelCard>
  )
}

/** Mini status line used by the autorun detail's linked-session panel. */
export function SessionStatusLine({ session }: { readonly session: Session }) {
  const chip = statusChipProps(session.status)
  return (
    <span className="ve-inline">
      <StatusChip status={chip.status} title={chip.title} compact />
      <span className="t-mono-inline">{`#${session.id}`}</span>
      <span className="ve-note ellipsis">{sessionTitle(session)}</span>
      <RouteLink to="/sessions/$sessionId" params={{ sessionId: String(session.id) }}>
        Open session
      </RouteLink>
    </span>
  )
}
