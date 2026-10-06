import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ApiError, getErrorMessage, isAdmin, useNameMaps } from "@/api"
import { fetchSession } from "@/api/endpoints"
import { queryKeys, resolveEntityName, staleTimes } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { isLive } from "@/api/domain/filter-grammar"
import { formatDateTime, formatDuration } from "@/api/time"
import { humanize } from "@/ui/lib/format"
import {
  EmptyState,
  ErrorPanel,
  IconExternal,
  IconSessions,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Stat,
  StatusChip,
  Tag,
} from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { RemuxProgressBar } from "./remux-progress"
import { SessionActionsMenu } from "./session-actions"

interface AttemptView {
  readonly index: number
  readonly status: string
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly exitCode: number | null
  readonly reason: string | null
}

/** Attempts arrive as loose records — read defensively, never assume a shape. */
function toAttemptView(raw: Record<string, unknown>, fallbackIndex: number): AttemptView {
  const str = (key: string): string | null => {
    const value = raw[key]
    return typeof value === "string" && value !== "" ? value : null
  }
  const num = (key: string): number | null => {
    const value = raw[key]
    return typeof value === "number" ? value : null
  }
  return {
    index: num("index") ?? num("attempt") ?? fallbackIndex + 1,
    status: str("status") ?? "unknown",
    startedAt: str("started_at"),
    endedAt: str("ended_at"),
    exitCode: num("exit_code"),
    reason: str("reason") ?? str("error"),
  }
}

function KeyValue({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="row-between">
      <span className="text-dim">{label}</span>
      <span className="mono text-truncate">{children}</span>
    </div>
  )
}

function ConfigBlock({ title, value }: { readonly title: string; readonly value: Record<string, unknown> }) {
  return (
    <div className="stack stack-sm">
      <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
        {title}
      </span>
      <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function SourceValue({ value }: { readonly value: string }) {
  if (!/^https?:/i.test(value)) return <span className="mono text-truncate">{value}</span>
  return (
    <a className="row" style={{ gap: "var(--s-1)" }} href={value} target="_blank" rel="noreferrer">
      <span className="mono text-truncate">{value}</span>
      <IconExternal size={13} />
    </a>
  )
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export function SessionDetailView({ sessionId }: { readonly sessionId: string }) {
  const names = useNameMaps()
  const query = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
    staleTime: staleTimes.detail,
    refetchInterval: (q) => (q.state.data !== undefined && isLive(q.state.data.status) ? 5000 : false),
  })
  const session = query.data
  const duration = useLiveDurationSeconds(session?.started_at, session?.ended_at)

  if (query.isLoading) {
    return (
      <Page title={`Session #${sessionId}`}>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={5} cols={3} />
          </PanelBody>
        </Panel>
      </Page>
    )
  }

  if (session === undefined) {
    return (
      <Page title={`Session #${sessionId}`}>
        {isNotFound(query.error) ? (
          <EmptyState
            icon={<IconSessions size={22} />}
            title="Session gone"
            text="It may have been deleted from another client."
            action={
              <Link className="btn btn-outline" to="/sessions">
                Back to sessions
              </Link>
            }
          />
        ) : (
          <ErrorPanel
            message={getErrorMessage(query.error, "Could not load this session")}
            onRetry={() => void query.refetch()}
          />
        )}
      </Page>
    )
  }

  const engine = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  const resolver = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
  const profile = resolveEntityName(session.profile_name, names.profiles, session.profile_id)
  const urls = session.session_urls ?? []
  const attempts = (session.attempts ?? [])
    .map((raw, index) => toAttemptView(raw, index))
    .sort((a, b) => b.index - a.index)
  const remuxing = session.status === "remuxing" || session.status === "finalizing"
  const retryCount = session.retry_attempts ?? 0
  const hasResolverConfig = session.resolver_config !== undefined && Object.keys(session.resolver_config).length > 0
  const hasRetryConfig = session.retry_config !== undefined && Object.keys(session.retry_config).length > 0
  const showOwner = isAdmin()

  return (
    <Page
      title={`Session #${session.id}`}
      description={`${engine} → ${resolver} · ${profile}`}
      actions={
        <>
          <Link className="btn btn-ghost" to="/sessions">
            All sessions
          </Link>
          <SessionActionsMenu session={session} />
        </>
      }
    >
      <Panel>
        <PanelHead
          title="Status"
          actions={
            <>
              <StatusChip status={session.status} />
              {retryCount > 0 ? <Tag accent>Retry {retryCount}</Tag> : null}
            </>
          }
        />
        <PanelBody>
          <div className="grid-3">
            <Stat label="Duration" value={duration === null ? "—" : formatDuration(duration)} />
            <Stat label="Started" value={session.started_at != null ? formatDateTime(session.started_at) : "Not started"} />
            <Stat label="Ended" value={session.ended_at != null ? formatDateTime(session.ended_at) : "—"} />
            <Stat label="Recording" value={session.recording === true ? "On" : "Off"} />
            <Stat label="Retry attempts" value={retryCount} />
            {showOwner ? (
              <Stat
                label="Requester token"
                value={
                  session.requester_user_token !== undefined && session.requester_user_token !== ""
                    ? `${session.requester_user_token.slice(0, 8)}…`
                    : "—"
                }
              />
            ) : null}
          </div>
          {remuxing ? <RemuxProgressBar sessionId={session.id} className="stack stack-sm" /> : null}
        </PanelBody>
      </Panel>

      <div className="grid-2">
        <Panel>
          <PanelHead title="Attempts" actions={getStatusDescriptor(session.status).label} />
          <PanelBody>
            {attempts.length === 0 ? (
              <p className="text-dim">Waiting for the supervisor — attempt 1 not started yet.</p>
            ) : (
              <div
                className="stack"
                style={{ maxHeight: 480, overflowY: "auto" }}
                role="list"
                aria-label="Attempt timeline"
              >
                {attempts.map((attempt) => (
                  <div key={attempt.index} className="stack stack-sm" role="listitem">
                    <div className="row-between">
                      <span className="row" style={{ gap: "var(--s-2)" }}>
                        <span className="mono tnum">#{attempt.index}</span>
                        <StatusChip status={attempt.status} />
                      </span>
                      <span className="text-dim">
                        {attempt.startedAt !== null ? formatDateTime(attempt.startedAt) : "—"}
                        {" → "}
                        {attempt.endedAt !== null ? formatDateTime(attempt.endedAt) : "running"}
                      </span>
                    </div>
                    {attempt.exitCode !== null || attempt.reason !== null ? (
                      <div className="row" style={{ gap: "var(--s-3)" }}>
                        {attempt.exitCode !== null ? (
                          <span className="mono tnum text-dim">exit {attempt.exitCode}</span>
                        ) : null}
                        {attempt.reason !== null ? <span className="text-dim">{attempt.reason}</span> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </PanelBody>
        </Panel>

        <div className="stack">
          <Panel>
            <PanelHead title="Live sources" />
            <PanelBody>
              {urls.length === 0 ? (
                <p className="text-dim">
                  Live URLs not configured (operator must set <span className="mono">web_url</span>).
                </p>
              ) : (
                <div className="stack">
                  {urls.map((entry, index) => (
                    <div key={index} className="stack stack-sm">
                      {Object.entries(entry).map(([key, value]) => (
                        <div key={key} className="row-between">
                          <span className="text-dim">{humanize(key)}</span>
                          <SourceValue value={value} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Config snapshot" />
            <PanelBody>
              <div className="stack">
                <div className="stack stack-sm">
                  <KeyValue label="Engine">{engine}</KeyValue>
                  <KeyValue label="Resolver">{resolver}</KeyValue>
                  <KeyValue label="Profile">{profile}</KeyValue>
                  <KeyValue label="Retry mode">{session.retry_mode ?? "—"}</KeyValue>
                  {session.session_folder !== undefined && session.session_folder !== null ? (
                    <KeyValue label="Folder">{session.session_folder}</KeyValue>
                  ) : null}
                </div>
                {hasResolverConfig && session.resolver_config !== undefined ? (
                  <ConfigBlock title="Resolver config" value={session.resolver_config} />
                ) : null}
                {hasRetryConfig && session.retry_config !== undefined ? (
                  <ConfigBlock title="Retry config" value={session.retry_config} />
                ) : null}
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </Page>
  )
}
