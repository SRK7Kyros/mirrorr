import { useMemo } from "react"
import { useParams } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonList } from "@/components/ui/Skeleton"
import { StatusChip } from "@/components/ui/StatusChip"
import { isAdmin } from "@/lib/auth"
import { queryKeys, resolveEntityName, staleTimes } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas"
import { ApiError } from "@/lib/api"
import { fetchSession } from "@/views/shared/api"
import { useEngines, useNameMaps } from "@/views/shared/hooks"
import { statusChipProps, sessionTitle, useLooseNavigate, useQueryRemoved } from "@/views/shared/parts"
import { SessionActionCluster } from "./session-action-cluster"
import { useSessionCommands } from "./session-commands"
import { RemuxBar } from "./remux-progress"
import {
  AttemptsPanel,
  ConfigPanel,
  LiveDuration,
  LiveUrlsPanel,
  PanelCard,
  TimelinePanel,
} from "./session-detail-panels"
import "@/styles/views-entities.css"

/**
 * §5.4 — Session detail. Panels: status header (chip, derived title, #id,
 * duration, owner) · actions row · attempts timeline · live sources · config
 * snapshot. `session.deleted` removes the detail query (the event table is
 * installed without a navigate option) — this view then returns to the list.
 */
export function SessionDetail() {
  const params = useParams({ strict: false }) as { sessionId?: string }
  const sessionId = params.sessionId ?? ""
  const navigate = useLooseNavigate()
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

  useQueryRemoved(queryKeys.session(sessionId), () => {
    void navigate({ to: "/sessions" })
  })

  const session = query.data
  const canRecord = useMemo(() => {
    if (session === undefined) return true
    return engines.find((entry) => entry.id === session.engine_id)?.capabilities?.can_record !== false
  }, [engines, session])

  if (query.isLoading) {
    return (
      <div className="ve">
        <SkeletonList rows={3} />
        <SkeletonList rows={6} />
      </div>
    )
  }

  if (query.isError || session === undefined) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="ve">
        <ErrorPanel
          title={notFound ? "Session gone" : "Could not load session"}
          body={
            notFound
              ? "It may have been deleted from another client."
              : query.error instanceof Error
                ? query.error.message
                : "Unexpected server response."
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => void query.refetch()}>
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
  const controlBlocked = state.controlError !== null

  return (
    <div className="ve">
      <header className="ve-detail-head">
        <StatusChip status={chip.status} title={state.deleting ? "Deleting…" : chip.title} />
        <h1 className="ve-detail-head__title">{sessionTitle(session)}</h1>
        <span className="t-mono-inline">{`#${session.id}`}</span>
        <span className="ve-note">{`${engineName} → ${resolverName}`}</span>
        <LiveDuration startedAt={session.started_at} endedAt={session.ended_at} />
        {admin ? (
          <span className="t-mono-inline ellipsis" title="Owner token">
            {session.requester_user_token == null || session.requester_user_token === ""
              ? "—"
              : session.requester_user_token.slice(0, 12)}
          </span>
        ) : null}
        <div className="ve-detail-head__actions">
          <SessionActionCluster session={session} canRecord={canRecord} commands={commands} variant="detail" />
          <Button variant="ghost" onClick={() => void navigate({ to: "/sessions" })}>
            Back
          </Button>
        </div>
      </header>

      {controlBlocked ? (
        <ErrorPanel
          title="Control unavailable — session may be stuck; consider delete"
          body={state.controlError ?? undefined}
          actions={
            <>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Refetch
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  commands.clearControlError(session.id)
                  void commands.remove(session)
                }}
              >
                Delete
              </Button>
            </>
          }
        />
      ) : null}

      {state.stillStopping ? (
        <ErrorPanel
          row
          title="No status change yet"
          body="The supervisor has not confirmed termination — you can hard-delete the session."
          actions={
            <Button variant="danger-text" onClick={() => void commands.remove(session)}>
              Hard delete
            </Button>
          }
        />
      ) : null}

      {state.deleting ? (
        <PanelCard title="Deleting">
          <p className="ve-note">
            The server removes the session after the supervisor exits (204 is accepted, not gone).
          </p>
        </PanelCard>
      ) : null}

      {session.status === "remuxing" ? (
        <PanelCard title="Remux progress">
          <RemuxBar session={session} />
        </PanelCard>
      ) : null}

      <div className="ve-detail-grid">
        <div className="ve-stack">
          <AttemptsPanel session={session} />
          <LiveUrlsPanel session={session} />
        </div>
        <aside className="ve-stack">
          <ConfigPanel session={session} names={names} />
          <TimelinePanel session={session} canRecord={canRecord} />
        </aside>
      </div>
    </div>
  )
}
