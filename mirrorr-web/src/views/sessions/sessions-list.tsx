import { useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Fab } from "@/components/ui/Fab"
import { Input } from "@/components/ui/Input"
import { StatusChip } from "@/components/ui/StatusChip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/Table"
import { IconPlus } from "@/components/ui/icons"
import { isAdmin } from "@/lib/auth"
import { queryKeys, resolveEntityName } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas"
import { useEntityList, useEngines, useHighlightRef, useIsCompact, useNameMaps } from "@/views/shared/hooks"
import { EngineResolverPair, RecordingCell, RouteLink, sessionTitle, statusChipProps } from "@/views/shared/parts"
import { LiveDuration } from "./session-detail-panels"
import { fetchSessionPage } from "@/views/shared/api"
import { NewSessionDialog } from "./new-session-dialog"
import { SessionActionCluster } from "./session-action-cluster"
import { RemuxBar } from "./remux-progress"
import { useSessionCommands } from "./session-commands"
import "@/styles/views-entities.css"

/** §5.3 — Sessions list (`/sessions`, the product home). */
export function SessionsList() {
  const names = useNameMaps()
  const engines = useEngines()
  const commands = useSessionCommands()
  const admin = isAdmin()
  const compact = useIsCompact()

  const list = useEntityList<Session>({
    queryKey: queryKeys.sessions({}),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  })

  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const highlight = useHighlightRef(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === "") return list.items
    return list.items.filter((session) => {
      const engineName = resolveEntityName(session.engine_name, names.engines, session.engine_id)
      const resolverName = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
      const profileName =
        session.profile_id == null ? "—" : resolveEntityName(session.profile_name, names.profiles, session.profile_id)
      return [`#${session.id}`, String(session.id), engineName, resolverName, profileName, session.status, sessionTitle(session)]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [list.items, names, search])

  const canRecordFor = (session: Session): boolean =>
    engines.find((entry) => entry.id === session.engine_id)?.capabilities?.can_record !== false

  const columns = admin ? 8 : 7
  const openDialog = () => setDialogOpen(true)

  return (
    <div className="ve">
      <div className="ve-bar">
        <Input
          label="Search sessions"
          placeholder="Name, engine, profile or id"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="ve-bar__end">
          <Button variant="primary" onClick={openDialog}>
            New session
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="opaque ve-table-panel">
          <Table label="Sessions">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Session</TableCell>
                <TableCell>Engine → Resolver</TableCell>
                <TableCell>Profile</TableCell>
                <TableCell>Recording</TableCell>
                <TableCell numeric>Duration</TableCell>
                {admin ? <TableCell>Owner</TableCell> : null}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody loading columns={columns} />
          </Table>
        </div>
      ) : list.isError ? (
        <ErrorPanel
          title="Could not load sessions"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response."}
          actions={
            <Button variant="secondary" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : list.items.length === 0 ? (
        <div className="opaque ve-panel">
          <EmptyState
            eyebrow="Sessions"
            headline="No sessions yet."
            body="Start a capture run from a saved profile, or configure an engine and resolver directly."
            action={
              <>
                <Button variant="primary" onClick={openDialog}>
                  New session
                </Button>
                <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                  Open profiles
                </Button>
              </>
            }
          />
        </div>
      ) : (
        <div className="opaque panel ve-table-panel">
          <Table label="Sessions" className="ve-table">
            <TableHead>
              <TableRow>
                <TableCell className="ve-c-status">Status</TableCell>
                <TableCell className="ve-c-title">Session</TableCell>
                <TableCell className="ve-c-pair">Engine → Resolver</TableCell>
                <TableCell className="ve-c-profile">Profile</TableCell>
                <TableCell className="ve-c-recording">Recording</TableCell>
                <TableCell className="ve-c-duration" numeric>
                  Duration
                </TableCell>
                {admin ? <TableCell className="ve-c-owner">Owner</TableCell> : null}
                <TableCell className="ve-c-actions">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody columns={columns}>
              {filtered.map((session) => {
                const chip = statusChipProps(session.status)
                const state = commands.stateOf(session.id)
                const label = state.deleting ? "Deleting…" : state.stopPending ? "Stopping…" : chip.title
                const engineName = resolveEntityName(session.engine_name, names.engines, session.engine_id)
                const resolverName = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
                return (
                  <TableRow key={session.id} className="ve-row-ref">
                    <TableCell className="ve-c-status">
                      <span ref={highlight} data-id={session.id} />
                      <StatusChip status={state.deleting ? "unknown" : chip.status} title={label} compact />
                    </TableCell>
                    <TableCell className="ve-c-title">
                      <span className="ve-title-cell">
                        <RouteLink to="/sessions/$sessionId" params={{ sessionId: String(session.id) }} className="ve-title-cell__name">
                          {sessionTitle(session)}
                        </RouteLink>
                        <span className="ve-title-cell__meta">
                          {`#${session.id}`}
                          {session.profile_id == null ? "" : ` · ${resolveEntityName(session.profile_name, names.profiles, session.profile_id)}`}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-pair">
                      <EngineResolverPair
                        engineName={engineName}
                        resolverName={resolverName}
                        tag={
                          session.autorun_id == null
                            ? undefined
                            : { label: "autorun", href: `/autoruns/${session.autorun_id}` }
                        }
                      />
                    </TableCell>
                    <TableCell className="ve-c-profile">
                      {session.profile_id == null ? (
                        <span className="ve-note">—</span>
                      ) : (
                        <RouteLink to="/profiles" search={{ highlight: session.profile_id }}>
                          {resolveEntityName(session.profile_name, names.profiles, session.profile_id)}
                        </RouteLink>
                      )}
                    </TableCell>
                    <TableCell className="ve-c-recording">
                      <RecordingCell recording={session.recording} canRecord={canRecordFor(session)} />
                    </TableCell>
                    <TableCell className="ve-c-duration" numeric>
                      <LiveDuration startedAt={session.started_at} endedAt={session.ended_at} />
                      <RemuxBar session={session} />
                    </TableCell>
                    {admin ? (
                      <TableCell className="ve-c-owner">
                        <span className="t-mono-inline ellipsis">
                          {session.requester_user_token == null || session.requester_user_token === ""
                            ? "—"
                            : session.requester_user_token.slice(0, 12)}
                        </span>
                      </TableCell>
                    ) : null}
                    <TableCell className="ve-c-actions">
                      <SessionActionCluster
                        session={session}
                        canRecord={canRecordFor(session)}
                        commands={commands}
                        variant="row"
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {list.items.length > 0 ? (
        <div className="ve-bar">
          <span className="ve-note">
            {`Showing ${filtered.length}${list.hasMore ? "+" : ""}`}
          </span>
          <div className="ve-bar__end">
            {list.hasMore ? (
              <Button variant="secondary" loading={list.isFetching} onClick={list.loadMore}>
                Load more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {compact ? (
        <Fab aria-label="New session" icon={<IconPlus size={24} />} onClick={openDialog} />
      ) : null}

      <NewSessionDialog key={`new-session-${dialogOpen ? "open" : "closed"}`} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
