import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { getErrorMessage, isAdmin, useEntityList, useNameMaps, type NameMaps } from "@/api"
import { fetchSessionPage } from "@/api/endpoints"
import { queryKeys, resolveEntityName } from "@/api/query-keys"
import {
  DEFAULT_FILTER,
  FILTER_TOKENS,
  isLive,
  isSpent,
  matchesFilter,
  shouldAutoExhaust,
  type FilterToken,
} from "@/api/domain/filter-grammar"
import type { Session } from "@/api/schemas"
import { formatDateTime, formatDuration } from "@/api/time"
import {
  Button,
  EmptyState,
  ErrorPanel,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSessions,
  Input,
  LoadMore,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Stat,
  StatusChip,
  Table,
  Tag,
  Td,
  Th,
} from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { RemuxProgressBar } from "./remux-progress"
import { NewSessionDialog } from "./new-session-dialog"
import { SessionActionsMenu } from "./session-actions"

const FILTER_LABELS: Record<FilterToken, string> = {
  scheduled: "Scheduled",
  live: "Live",
  spent: "Spent",
  all: "All",
}

/** Source URL tail for the ID cell (spec §5.3 "derived title" — decision 11.3). */
function sourceTail(session: Session): string | null {
  for (const entry of session.session_urls ?? []) {
    for (const value of Object.values(entry)) {
      if (!/^https?:/i.test(value)) continue
      try {
        const tail = new URL(value).pathname.split("/").filter(Boolean).pop()
        if (tail !== undefined && tail !== "") return decodeURIComponent(tail)
      } catch {
        // Not a parsable URL — keep looking.
      }
    }
  }
  return null
}

function SessionRow({
  session,
  names,
  showOwner,
  columnCount,
}: {
  readonly session: Session
  readonly names: NameMaps
  readonly showOwner: boolean
  readonly columnCount: number
}) {
  const duration = useLiveDurationSeconds(session.started_at, session.ended_at)
  const tail = sourceTail(session)
  const remuxing = session.status === "remuxing" || session.status === "finalizing"

  return (
    <>
      <tr>
        <Td>
          <StatusChip status={session.status} />
        </Td>
        <Td>
          <Link className="table-row-link" to="/sessions/$sessionId" params={{ sessionId: String(session.id) }}>
            <span className="mono tnum">#{session.id}</span>
          </Link>
          {tail !== null ? (
            <div className="text-dim text-truncate" title={tail}>
              {tail}
            </div>
          ) : null}
        </Td>
        <Td>
          {resolveEntityName(session.engine_name, names.engines, session.engine_id)}
          <span className="text-dim" aria-hidden="true">
            {" → "}
          </span>
          {resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)}
        </Td>
        <Td>{resolveEntityName(session.profile_name, names.profiles, session.profile_id)}</Td>
        <Td>{session.started_at != null ? formatDateTime(session.started_at) : <span className="text-dim">—</span>}</Td>
        <Td num>{duration === null ? <span className="text-dim">—</span> : formatDuration(duration)}</Td>
        <Td>{session.recording === true ? <Tag accent>REC</Tag> : <span className="text-dim">—</span>}</Td>
        {showOwner ? (
          <Td>
            {session.requester_user_token !== undefined && session.requester_user_token !== "" ? (
              <span className="mono text-truncate" title={session.requester_user_token}>
                {session.requester_user_token.slice(0, 8)}…
              </span>
            ) : (
              <span className="text-dim">—</span>
            )}
          </Td>
        ) : null}
        <Td actions>
          <SessionActionsMenu session={session} />
        </Td>
      </tr>
      {remuxing ? (
        <tr>
          <td colSpan={columnCount}>
            <RemuxProgressBar sessionId={session.id} className="stack stack-sm" />
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function SessionsListView() {
  const [tokens, setTokens] = useState<readonly FilterToken[]>(() => [...DEFAULT_FILTER])
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const names = useNameMaps()
  const showOwner = isAdmin()

  const list = useEntityList<Session>({
    queryKey: queryKeys.sessions({ filter: tokens.join("+") }),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list
  const autoExhaust = shouldAutoExhaust(tokens)

  // Non-`all` filters are a client-side scope over the whole (small) set.
  useEffect(() => {
    if (!autoExhaust || !hasMore || loadingAll || isFetching) return
    void loadAll()
  }, [autoExhaust, hasMore, loadingAll, isFetching, loadAll])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return list.items.filter((session) => {
      if (!matchesFilter(session.status, tokens)) return false
      if (term === "") return true
      return [
        String(session.id),
        session.profile_name ?? "",
        session.engine_name ?? "",
        session.resolver_name ?? "",
        session.status,
        session.session_folder ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    })
  }, [list.items, tokens, search])

  const tally = useMemo(() => {
    let live = 0
    let recording = 0
    let scheduled = 0
    let spent = 0
    for (const session of list.items) {
      if (isLive(session.status)) live += 1
      if (session.status === "recording") recording += 1
      if (session.status === "scheduled") scheduled += 1
      if (isSpent(session.status)) spent += 1
    }
    return { live, recording, scheduled, spent }
  }, [list.items])

  const toggleToken = (token: FilterToken) => {
    if (token === "all") {
      setTokens(["all"])
      return
    }
    const without = tokens.filter((value) => value !== "all" && value !== token)
    const next = tokens.includes(token) ? without : [...without, token]
    setTokens(next.length === 0 ? ["all"] : next)
  }

  const columnCount = showOwner ? 9 : 8

  return (
    <Page
      title="Sessions"
      description="Live and recent capture runs. Status filtering and search apply to the rows loaded so far."
      actions={
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          New session
        </Button>
      }
    >
      <Panel>
        <PanelHead
          title="Tally"
          actions={
            <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              over {list.items.length} loaded
            </span>
          }
        />
        <PanelBody>
          <div className="grid-3">
            <Stat
              label="Live"
              value={
                <>
                  {tally.live}
                  {tally.recording > 0 ? <span className="text-dim"> · {tally.recording} recording</span> : null}
                </>
              }
            />
            <Stat label="Scheduled" value={tally.scheduled} />
            <Stat label="Spent" value={tally.spent} />
          </div>
        </PanelBody>
      </Panel>

      <div className="toolbar">
        <div className="row">
          {FILTER_TOKENS.map((token) => (
            <Button
              key={token}
              size="sm"
              variant={tokens.includes(token) ? "primary" : "outline"}
              aria-pressed={tokens.includes(token)}
              onClick={() => toggleToken(token)}
            >
              {FILTER_LABELS[token]}
            </Button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-search">
          <span className="toolbar-search-icon" aria-hidden="true">
            <IconSearch size={15} />
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by id, profile, engine, status…"
            aria-label="Filter sessions"
          />
        </div>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={15} />} loading={isFetching} onClick={list.refetch}>
          Refresh
        </Button>
      </div>

      {list.isLoading ? (
        <Panel>
          <PanelBody>
            <SkeletonRows rows={8} cols={6} />
          </PanelBody>
        </Panel>
      ) : list.isError ? (
        <ErrorPanel message={getErrorMessage(list.error, "Could not load sessions")} onRetry={list.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconSessions size={22} />}
          title={list.items.length === 0 ? "No sessions yet." : "Nothing matches this filter"}
          text={
            list.items.length === 0
              ? "A session is one capture run. Start one from a profile, or build the config by hand."
              : "Widen the status filter or clear the search box."
          }
          action={
            list.items.length === 0 ? (
              <div className="row">
                <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
                  New session
                </Button>
                <Link className="btn btn-secondary" to="/profiles">
                  Open profiles
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <Panel>
            <PanelBody flush>
              <Table>
                <thead>
                  <tr>
                    <Th>Status</Th>
                    <Th>Session</Th>
                    <Th>Engine → Resolver</Th>
                    <Th>Profile</Th>
                    <Th>Started</Th>
                    <Th num>Duration</Th>
                    <Th>Rec</Th>
                    {showOwner ? <Th>Owner</Th> : null}
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      names={names}
                      showOwner={showOwner}
                      columnCount={columnCount}
                    />
                  ))}
                </tbody>
              </Table>
            </PanelBody>
          </Panel>
          <LoadMore
            hasMore={hasMore}
            isFetching={isFetching}
            onLoadMore={list.loadMore}
            onLoadAll={() => void loadAll()}
            loadingAll={loadingAll}
            count={rows.length}
          />
        </>
      )}

      <NewSessionDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
