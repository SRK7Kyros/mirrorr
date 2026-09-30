import { useMemo } from "react"
import { useParams } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonList } from "@/components/ui/Skeleton"
import { StatusChip } from "@/components/ui/StatusChip"
import { isAdmin } from "@/lib/auth"
import { queryKeys, queryRoots, resolveEntityName, staleTimes } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas"
import { formatDateTime } from "@/lib/time"
import { fetchSession } from "@/views/shared/api"
import { useEngines, useFormattedDuration, useNameMaps } from "@/views/shared/hooks"
import { statusChipProps, useLooseNavigate, useQueryRemoved } from "@/views/shared/parts"
import { SessionActionCluster } from "./session-action-cluster"
import { useSessionCommands } from "./session-commands"
import {
  AttemptsPanel,
  ConfigPanel,
  LiveUrlsPanel,
  PanelCard,
  RecordingPanel,
  RemuxPanel,
} from "./session-detail-panels"

/**
 * V4 — Session detail (`/sessions/$sessionId`). Header (status chip aria-live,
 * #id, engine→resolver, owner, live 1s duration) + action cluster; body
 * `list-detail` 1fr/360px ≥1100px (compact order: Recording → Live URLs →
 * Remux → Attempts → Config via CSS source order). `session.deleted` WS
 * removal of this query navigates back to `/sessions` (the event table is
 * installed without its navigate option).
 */
export function SessionDetail() {
  const params = useParams({ strict: false }) as { sessionId?: string }
  const sessionId = params.sessionId ?? ""
  const navigate = useLooseNavigate()
  const client = useQueryClient()
  const names = useNameMaps()
  const engines = useEngines()
  const commands = useSessionCommands()
  const admin = isAdmin()

  const query = useQuery<Session>({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
    staleTime: staleTimes.detail,
    retry: false,
  })

  // session.deleted → detail query removed by the event table → navigate away.
  useQueryRemoved(queryKeys.session(sessionId), () => {
    void navigate({ to: "/sessions" })
  })

  const session = query.data
  const duration = useFormattedDuration(session?.started_at, session?.ended_at)

  const canRecord = useMemo(() => {
    if (session === undefined) return true
    const engine = engines.find((entry) => entry.id === session.engine_id)
    return engine?.capabilities?.can_record !== false
  }, [engines, session])

  if (query.isLoading) {
    return (
      <div className="view">
        <SkeletonList rows={5} />
      </div>
    )
  }

  if (query.isError || session === undefined) {
    return (
      <div className="view">
        <ErrorPanel
          title="Session not found"
          body={query.error instanceof Error ? query.error.message : "The session is gone or never existed."}
          actions={
            <>
              <Button variant="ghost" onClick={() => void query.refetch()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => void navigate({ to: "/sessions" })}>
                Back to sessions
              </Button>
            </>
          }
        />
      </div>
    )
  }

  const chip = statusChipProps(session.status)
  const state = commands.stateOf(session.id)
  const engineName = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  const resolverName = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)

  return (
    <div className="view">
      <header className="detail-header">
        <StatusChip status={chip.status} title={state.deleting ? "Deleting…" : chip.title} />
        <h1 className="t-mono-inline">{`#${session.id}`}</h1>
        <span className="engine-pair__strong">
          {engineName}
          {" → "}
          {resolverName}
        </span>
        {admin ? (
          <span className="t-mono-inline" title="Owner token">
            {session.requester_user_token == null || session.requester_user_token === ""
              ? "—"
              : session.requester_user_token.slice(0, 12)}
          </span>
        ) : null}
        <span className="detail-duration num">{duration}</span>
        <div className="detail-header__actions">
          <SessionActionCluster
            session={session}
            canRecord={canRecord}
            commands={commands}
            variant="detail"
          />
          <Button variant="ghost" onClick={() => void navigate({ to: "/sessions" })}>
            Back
          </Button>
        </div>
      </header>

      {state.controlError !== null ? (
        <ErrorPanel
          title="Control unavailable — session may be stuck"
          body={state.controlError}
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                commands.clearControlError(session.id)
                void commands.remove(session)
              }}
            >
              Force delete
            </Button>
          }
        />
      ) : null}

      {state.stillStopping ? (
        <ErrorPanel
          row
          title="Still stopping…"
          body="The session has not confirmed termination — you can force-delete it."
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                void commands.remove(session)
              }}
            >
              Force delete
            </Button>
          }
        />
      ) : null}

      {state.deleting ? (
        <div className="card" data-deleting="true">
          <p className="t-body">Deleting…</p>
          <p className="t-meta">
            Waiting for the server to confirm — refetched after 15s.{" "}
            <button type="button" className="btn btn--ghost" onClick={() => void client.invalidateQueries({ queryKey: queryRoots.sessions })}>
              Check now
            </button>
          </p>
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="detail-grid__main card-stack">
          <LiveUrlsPanel session={session} />
          <RemuxPanel session={session} />
          <AttemptsPanel session={session} />
          <ConfigPanel session={session} />
        </div>
        <aside className="detail-grid__aside card-stack">
          <RecordingPanel session={session} canRecord={canRecord} />
          <PanelCard title="Timeline">
            <dl className="kv">
              <dt className="kv__label">Started</dt>
              <dd className="kv__value">
                {session.started_at == null ? "—" : formatDateTime(session.started_at)}
              </dd>
              <dt className="kv__label">Ended</dt>
              <dd className="kv__value">
                {session.ended_at == null ? "—" : formatDateTime(session.ended_at)}
              </dd>
              <dt className="kv__label">Status</dt>
              <dd className="kv__value">{chip.title}</dd>
            </dl>
          </PanelCard>
        </aside>
      </div>
    </div>
  )
}
