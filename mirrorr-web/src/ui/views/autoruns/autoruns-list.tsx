import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { getErrorMessage, isAdmin, useEntityList, useNameMaps, type NameMaps } from "@/api"
import { fetchAutorunPage } from "@/api/endpoints"
import { queryKeys, resolveEntityName } from "@/api/query-keys"
import {
  DEFAULT_FILTER,
  FILTER_TOKENS,
  isSpent,
  matchesFilter,
  shouldAutoExhaust,
  type FilterToken,
} from "@/api/domain/filter-grammar"
import type { Autorun } from "@/api/schemas"
import { formatCountdown, formatDateTime } from "@/api/time"
import {
  Button,
  EmptyState,
  ErrorPanel,
  IconAutoruns,
  IconClock,
  IconPlus,
  IconRefresh,
  IconSearch,
  Input,
  LoadMore,
  Panel,
  PanelBody,
  SkeletonRows,
  StatusChip,
  Table,
  Tag,
  Td,
  Th,
} from "@/ui/components"
import { useNowTick } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { AutorunActionsMenu } from "./autorun-actions"
import { AutorunFormDialog } from "./autorun-form-dialog"

/** `scheduled` renders as the spec's "Upcoming" filter (spec §5.5). */
const FILTER_LABELS: Record<FilterToken, string> = {
  scheduled: "Upcoming",
  live: "Live",
  spent: "Spent",
  all: "All",
}

/** "starts in ~12 min" for a `scheduled` row — tick-granular, never seconds. */
function countdownFor(autorun: Autorun, now: Date): string | null {
  if (autorun.status !== "scheduled") return null
  const next = autorun.next_run_at
  const target = next !== null && next !== undefined && next !== "" ? next : autorun.start_time
  return formatCountdown(target, now)
}

function AutorunRow({
  autorun,
  names,
  showOwner,
  now,
}: {
  readonly autorun: Autorun
  readonly names: NameMaps
  readonly showOwner: boolean
  readonly now: Date
}) {
  const spent = isSpent(autorun.status)
  const countdown = countdownFor(autorun, now)
  const owner = autorun.requester_user_token

  return (
    <tr className={spent ? "text-muted" : undefined}>
      <Td>
        <StatusChip status={autorun.status} />
      </Td>
      <Td>
        <Link className="table-row-link" to="/autoruns/$autorunId" params={{ autorunId: String(autorun.id) }}>
          {autorun.user_friendly_name}
        </Link>
        <div>
          <Tag title={autorun.snake_case_name}>{autorun.snake_case_name}</Tag>
        </div>
      </Td>
      <Td>
        <span className="text-truncate">
          {formatDateTime(autorun.start_time)}
          <span aria-hidden="true">{" → "}</span>
          {formatDateTime(autorun.end_time)}
        </span>
        <div className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          stored UTC
        </div>
      </Td>
      <Td>
        {countdown === null ? (
          <span className="text-dim">—</span>
        ) : (
          <span className="row" style={{ gap: "var(--s-1)" }}>
            <IconClock size={14} />
            {countdown}
          </span>
        )}
      </Td>
      <Td>
        {resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)}
        <span className="text-dim" aria-hidden="true">
          {" → "}
        </span>
        {resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)}
      </Td>
      <Td>{resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)}</Td>
      <Td>{autorun.recording === true ? <Tag accent>REC</Tag> : <span className="text-dim">—</span>}</Td>
      {showOwner ? (
        <Td>
          {owner !== undefined && owner !== "" ? (
            <span className="mono text-truncate" title={owner}>
              {owner.slice(0, 8)}…
            </span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </Td>
      ) : null}
      <Td actions>
        <AutorunActionsMenu autorun={autorun} />
      </Td>
    </tr>
  )
}

export function AutorunsListView() {
  const [tokens, setTokens] = useState<readonly FilterToken[]>(() => [...DEFAULT_FILTER])
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const names = useNameMaps()
  const showOwner = isAdmin()
  const now = useNowTick()

  const list = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns({ filter: tokens.join("+") }),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
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
    return list.items.filter((autorun) => {
      if (!matchesFilter(autorun.status, tokens)) return false
      if (term === "") return true
      return [
        String(autorun.id),
        autorun.user_friendly_name,
        autorun.snake_case_name,
        autorun.status,
        autorun.profile_name ?? "",
        autorun.engine_name ?? "",
        autorun.resolver_name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    })
  }, [list.items, tokens, search])

  const toggleToken = (token: FilterToken) => {
    if (token === "all") {
      setTokens(["all"])
      return
    }
    const without = tokens.filter((value) => value !== "all" && value !== token)
    const next = tokens.includes(token) ? without : [...without, token]
    setTokens(next.length === 0 ? ["all"] : next)
  }

  return (
    <Page
      title="Autoruns"
      description="Scheduled recordings. A scheduled recording runs once at its start time and then retires — status filtering and search apply to the rows loaded so far."
      actions={
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          New scheduled recording
        </Button>
      }
    >
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
            placeholder="Filter by name, slug, engine, status…"
            aria-label="Filter scheduled recordings"
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
        <ErrorPanel
          message={getErrorMessage(list.error, "Could not load scheduled recordings")}
          onRetry={list.refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconAutoruns size={22} />}
          title={list.items.length === 0 ? "No scheduled recordings." : "Nothing matches this filter"}
          text={
            list.items.length === 0
              ? "A scheduled recording runs once at its start time and then retires."
              : "Widen the status filter or clear the search box."
          }
          action={
            list.items.length === 0 ? (
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
                New scheduled recording
              </Button>
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
                    <Th>Scheduled recording</Th>
                    <Th>Window</Th>
                    <Th>Countdown</Th>
                    <Th>Engine → Resolver</Th>
                    <Th>Profile</Th>
                    <Th>Rec</Th>
                    {showOwner ? <Th>Owner</Th> : null}
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((autorun) => (
                    <AutorunRow
                      key={autorun.id}
                      autorun={autorun}
                      names={names}
                      showOwner={showOwner}
                      now={now}
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

      <AutorunFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
