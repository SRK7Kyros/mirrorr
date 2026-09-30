import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/Button"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Fab } from "@/components/ui/Fab"
import { Input } from "@/components/ui/Input"
import { SkeletonList } from "@/components/ui/Skeleton"
import { isAdmin } from "@/lib/auth"
import { queryKeys, resolveEntityName } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas"
import { formatDateTime, formatRelativeTime } from "@/lib/time"
import { fetchSessionPage } from "@/views/shared/api"
import {
  useEntityList,
  useEngines,
  useHighlightRef,
  useNameMaps,
  useIsCompact,
} from "@/views/shared/hooks"
import {
  CopyButton,
  EngineResolverPair,
  RecordingCell,
  RouteLink,
  sessionDurationLabel,
  statusChipProps,
} from "@/views/shared/parts"
import { IconPlus } from "@/components/ui/icons"
import { NewSessionDialog } from "./new-session-dialog"
import { SessionActionCluster } from "./session-action-cluster"
import { useSessionCommands } from "./session-commands"
import { StatusChip } from "@/components/ui/StatusChip"

/**
 * V3 — Sessions list (`/sessions`, home). Infinite table (cards <900px via
 * CSS reflow), WS-patched rows through the shared query keys, search over
 * loaded pages + "Load all" while has_more, name memo-map rendering.
 */
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
  const [loadAllWanted, setLoadAllWanted] = useState(false)

  // Auto-exhaust pagination when "Load all" is requested (search scope rule).
  useEffect(() => {
    if (!loadAllWanted || !list.hasMore) return
    void list.loadAll().then(() => setLoadAllWanted(false))
  }, [loadAllWanted, list])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === "") return list.items
    return list.items.filter((session) => {
      const engineName = resolveEntityName(session.engine_name, names.engines, session.engine_id)
      const resolverName = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
      const profileName = session.profile_id == null ? "—" : resolveEntityName(session.profile_name, names.profiles, session.profile_id)
      const haystack = [
        `#${session.id}`,
        String(session.id),
        engineName,
        resolverName,
        profileName,
        session.status,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [list.items, names, search])

  const canRecordFor = (session: Session): boolean => {
    const engine = engines.find((entry) => entry.id === session.engine_id)
    return engine?.capabilities?.can_record !== false
  }

  const highlight = useHighlightRef(null)
  const openDialog = () => setDialogOpen(true)

  const body = (() => {
    if (list.isLoading) return <SkeletonList rows={5} />
    if (list.isError) {
      return (
        <ErrorPanel
          title="Request failed"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response"}
          actions={
            <Button variant="ghost" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      )
    }
    if (list.items.length === 0) {
      return (
        <EmptyState
          headline="Nothing here yet"
          body="No sessions yet — start your first recording"
        />
      )
    }
    return (
      <>
        <table className="entity-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">ID</th>
              <th scope="col">Engine → Resolver</th>
              <th scope="col" data-col="profile">
                Profile
              </th>
              <th scope="col">Recording</th>
              <th scope="col">Started</th>
              <th scope="col">Duration</th>
              {admin ? (
                <th scope="col" data-col="owner">
                  Owner
                </th>
              ) : null}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((session) => {
              const chip = statusChipProps(session.status)
              const engineName = resolveEntityName(session.engine_name, names.engines, session.engine_id)
              const resolverName = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
            
              const state = commands.stateOf(session.id)
  const label = state.deleting
    ? "Deleting…"
    : state.stopPending
      ? "Stopping…"
      : chip.title
              return (
                <tr
                  key={session.id}
                  className="entity-row"
                  ref={highlight}
                  data-spent={state.deleting ? "true" : undefined}
                >
                  <td data-col="status">
                    <StatusChip
                      status={state.deleting ? "unknown" : chip.status}
                      title={label}
                      compact
                    />
                  </td>
                  <td data-col="id">
                    <span className="t-mono-inline">{`#${session.id}`}</span>
                  </td>
                  <td data-col="enginepair">
                    <EngineResolverPair
                      engineName={engineName}
                      resolverName={resolverName}
                      tag={
                        session.autorun_id == null
                          ? undefined
                          : { label: "autorun", href: `/autoruns/${session.autorun_id}` }
                      }
                    />
                  </td>
                  <td data-col="profile">
                    {session.profile_id == null ? (
                      <span className="t-meta">—</span>
                    ) : (
                      <RouteLink
                        to="/profiles"
                        search={{ highlight: session.profile_id }}
                        className="t-body"
                      >
                        {resolveEntityName(session.profile_name, names.profiles, session.profile_id)}
                      </RouteLink>
                    )}
                  </td>
                  <td data-col="recording">
                    <RecordingCell recording={session.recording} canRecord={canRecordFor(session)} />
                  </td>
                  <td data-col="started">
                    <span className="t-body" title={session.started_at == null ? undefined : formatDateTime(session.started_at)}>
                      {session.started_at == null ? "—" : formatRelativeTime(session.started_at)}
                    </span>
                  </td>
                  <td data-col="duration">
                    <span className="t-mono-inline num">{sessionDurationLabel(session)}</span>
                  </td>
                  {admin ? (
                    <td data-col="owner">
                      <span className="t-mono-inline ellipsis">
                        {session.requester_user_token == null || session.requester_user_token === ""
                          ? "—"
                          : session.requester_user_token.slice(0, 12)}
                      </span>
                    </td>
                  ) : null}
                  <td data-col="actions">
                    <SessionActionCluster
                      session={session}
                      canRecord={canRecordFor(session)}
                      commands={commands}
                      variant="row"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.map((session) => {
          const state = commands.stateOf(session.id)
          if (state.controlError === null) return null
          return (
            <ErrorPanel
              key={`err-${session.id}`}
              row
              title="Control unavailable — session may be stuck"
              body={state.controlError}
              actions={
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      commands.clearControlError(session.id)
                      void commands.remove(session)
                    }}
                  >
                    Force delete
                  </Button>
                  <CopyButton text={String(session.id)} label="Copy session id" />
                </>
              }
            />
          )
        })}
      </>
    )
  })()

  return (
    <div className="view">
      <div className="view-header">
        <div className="list-toolbar">
          <div className="list-toolbar__search">
            <Input
              label="Search sessions"
              placeholder="Name or id"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {/* hint row (§5 V3): sits with the input it constrains, not inline
                in the toolbar where it read as an orphan */}
            <span className="search-hint">Filter applies to loaded rows</span>
          </div>
          {list.hasMore ? (
            <Button
              variant="ghost"
              loading={list.loadingAll || loadAllWanted}
              onClick={() => setLoadAllWanted(true)}
            >
              Load all
            </Button>
          ) : null}
        </div>
        <div className="view-header__actions">
          <Button variant="primary" onClick={openDialog}>
            New session
          </Button>
        </div>
      </div>

      {body}

      {list.items.length > 0 ? (
        <div className="list-footer">
          <span className="num">{`Showing ${filtered.length}`}</span>
          {list.hasMore ? (
            <Button variant="ghost" loading={list.isFetching} onClick={list.loadMore}>
              Load more
            </Button>
          ) : null}
          <CopyButton text={String(filtered.length)} label="Copy loaded count" />
        </div>
      ) : null}

      {compact ? (
        <Fab aria-label="New session" icon={<IconPlus size={24} />} onClick={openDialog} />
      ) : null}

      <NewSessionDialog key={dialogOpen ? "open" : "closed"} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
