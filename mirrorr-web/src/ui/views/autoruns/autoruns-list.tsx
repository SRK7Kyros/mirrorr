import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteAutorun,
  downloadJson,
  fetchAutorunExport,
  getErrorMessage,
  isAdmin,
  mergeBundles,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
  type NameMaps,
} from "@/api"
import { fetchAutorunPage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName } from "@/api/query-keys"
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
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  Fab,
  IconAutoruns,
  IconClock,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
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
  toast,
} from "@/ui/components"
import { useNowTick, useSelection } from "@/ui/hooks"
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
  selected,
  onToggle,
}: {
  readonly autorun: Autorun
  readonly names: NameMaps
  readonly showOwner: boolean
  readonly now: Date
  readonly selected: boolean
  readonly onToggle: (id: number) => void
}) {
  const spent = isSpent(autorun.status)
  const countdown = countdownFor(autorun, now)
  const owner = autorun.requester_user_token

  return (
    <tr data-id={autorun.id} data-selected={selected} className={spent ? "text-muted" : undefined}>
      <Td className="cell-check">
        <Checkbox
          aria-label={`Select ${autorun.user_friendly_name}`}
          checked={selected}
          onChange={() => onToggle(autorun.id)}
        />
      </Td>
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
  const queryClient = useQueryClient()
  const [tokens, setTokens] = useState<readonly FilterToken[]>(() => [...DEFAULT_FILTER])
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const selection = useSelection<number>()
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

  const rowIds = useMemo(() => rows.map((autorun) => autorun.id), [rows])
  const selectedAutoruns = list.items.filter((autorun) => selection.has(autorun.id))

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      for (const id of ids) await deleteAutorun(id)
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) {
        removeFromInfiniteLists(queryClient, queryRoots.autoruns, id)
        queryClient.removeQueries({ queryKey: queryKeys.autorun(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      toast.success("Scheduled recordings deleted", `${ids.length} removed`)
      selection.clear()
    },
    onError: (error) => toast.error("Could not delete the recordings", getErrorMessage(error, "Request failed")),
  })

  const bulkExport = useMutation({
    mutationFn: async (targets: readonly Autorun[]) => {
      const bundles = await Promise.all(targets.map((target) => fetchAutorunExport(target.id)))
      return mergeBundles(bundles)
    },
    onSuccess: (bundle, targets) => {
      if (downloadJson(`autoruns-${targets.length}.json`, bundle)) {
        toast.success("Scheduled recordings exported", `${targets.length} bundled`)
        selection.clear()
      } else {
        toast.error("Export failed", "The download could not be started.")
      }
    },
    onError: (error) => toast.error("Could not export the recordings", getErrorMessage(error, "Request failed")),
  })

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
        <Button variant="primary" className="btn-create" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          New scheduled recording
        </Button>
      }
    >
      <Fab label="New scheduled recording" icon={<IconPlus size={22} />} onClick={() => setCreateOpen(true)} />

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
                    <Th className="cell-check">
                      <Checkbox
                        aria-label="Select all scheduled recordings"
                        checked={selection.allSelected(rowIds)}
                        onChange={(event) => selection.setMany(event.target.checked ? rowIds : [])}
                      />
                    </Th>
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
                      selected={selection.has(autorun.id)}
                      onToggle={selection.toggle}
                    />
                  ))}
                </tbody>
              </Table>
            </PanelBody>
          </Panel>
          {selection.count > 0 ? (
            <BulkBar count={selection.count} onClear={selection.clear}>
              <Button
                size="sm"
                variant="outline"
                icon={<IconDownload size={15} />}
                loading={bulkExport.isPending}
                onClick={() => bulkExport.mutate(selectedAutoruns)}
              >
                Export selected
              </Button>
              <Button
                size="sm"
                variant="danger-ghost"
                icon={<IconTrash size={15} />}
                loading={bulkRemove.isPending}
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete selected
              </Button>
            </BulkBar>
          ) : null}
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

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selection.count} selected scheduled recording${selection.count === 1 ? "" : "s"}?`}
        description="A scheduled recording that has already run cannot be deleted — only upcoming ones can."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync([...selection.selected])
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />

      <AutorunFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
