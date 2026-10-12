import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteAutorun,
  downloadJson,
  fetchAutorunExport,
  getErrorMessage,
  mergeBundles,
  removeFromInfiniteLists,
  updateAutorun,
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
  IconProfiles,
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
import { AutorunBulkProfileDialog } from "./autorun-bulk-profile-dialog"
import { AutorunFormDialog } from "./autorun-form-dialog"

/** `scheduled` renders as the spec's "Upcoming" filter (spec §5.5). */
const FILTER_LABELS: Record<FilterToken, string> = {
  scheduled: "Upcoming",
  live: "Live",
  spent: "Spent",
  all: "All",
}

/** When the autorun will next run — the re-armed time if set, else its start. */
function runTarget(autorun: Autorun): string {
  const next = autorun.next_run_at
  return next !== null && next !== undefined && next !== "" ? next : autorun.start_time
}

/** "starts in ~12 min" for a `scheduled` row — tick-granular, never seconds. */
function countdownFor(autorun: Autorun, now: Date): string | null {
  if (autorun.status !== "scheduled") return null
  return formatCountdown(runTarget(autorun), now)
}

/** Epoch ms, or `null` for an unusable timestamp (which sorts last). */
function runTargetMs(autorun: Autorun): number | null {
  const parsed = Date.parse(runTarget(autorun))
  return Number.isNaN(parsed) ? null : parsed
}

/** Soonest first, so the next recording to run leads the list; id breaks ties. */
function bySoonest(a: Autorun, b: Autorun): number {
  const left = runTargetMs(a)
  const right = runTargetMs(b)
  if (left === null || right === null) {
    if (left === right) return a.id - b.id
    return left === null ? 1 : -1
  }
  return left !== right ? left - right : a.id - b.id
}

function AutorunRow({
  autorun,
  names,
  now,
  selected,
  onToggle,
}: {
  readonly autorun: Autorun
  readonly names: NameMaps
  readonly now: Date
  readonly selected: boolean
  readonly onToggle: (id: number) => void
}) {
  const spent = isSpent(autorun.status)
  const countdown = countdownFor(autorun, now)

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
        <Link
          className="text-ink font-medium hover:text-brand"
          to="/autoruns/$autorunId"
          params={{ autorunId: String(autorun.id) }}
        >
          {autorun.user_friendly_name}
        </Link>
        <div>
          <Tag className="max-w-full overflow-hidden text-ellipsis" title={autorun.snake_case_name}>
                {autorun.snake_case_name}
              </Tag>
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
          <span className="flex items-center gap-3" style={{ gap: "var(--s-1)" }}>
            <IconClock size={14} />
            {countdown}
          </span>
        )}
      </Td>
      <Td>
        {resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)}
        <span className="text-dim" aria-hidden="true">
          {" → "}
        </span>
        {resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)}
      </Td>
      <Td>{resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)}</Td>
      <Td>{autorun.recording === true ? <Tag accent>REC</Tag> : <span className="text-dim">—</span>}</Td>
      {__ADMIN__ ? (
        <Td>
          {autorun.requester_user_token !== undefined && autorun.requester_user_token !== "" ? (
            <span className="mono text-truncate" title={autorun.requester_user_token}>
              {autorun.requester_user_token}
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

/** The narrow-screen stand-in for `AutorunRow`. Only the title links — a
    whole-card click would swallow the checkbox and the actions menu. */
function AutorunCard({
  autorun,
  names,
  now,
  selected,
  onToggle,
}: {
  readonly autorun: Autorun
  readonly names: NameMaps
  readonly now: Date
  readonly selected: boolean
  readonly onToggle: (id: number) => void
}) {
  const countdown = countdownFor(autorun, now)
  const owner = autorun.requester_user_token

  return (
    <article
      className="entity-card flex flex-col gap-3 p-4 border border-line rounded-md bg-surface-2 data-[selected=true]:bg-[var(--accent-dim)] data-[selected=true]:shadow-[inset_2px_0_0_var(--accent)]"
      data-selected={selected}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)", minWidth: 0, alignItems: "flex-start" }}>
          <span className="flex items-center">
            <Checkbox
              aria-label={`Select ${autorun.user_friendly_name}`}
              checked={selected}
              onChange={() => onToggle(autorun.id)}
            />
          </span>
          <div style={{ minWidth: 0 }}>
            <Link
              className="text-md font-semibold text-ink [overflow-wrap:anywhere]"
              to="/autoruns/$autorunId"
              params={{ autorunId: String(autorun.id) }}
            >
              {autorun.user_friendly_name}
            </Link>
            <div className="text-sm text-ink-muted">
              <Tag className="max-w-full overflow-hidden text-ellipsis" title={autorun.snake_case_name}>
                {autorun.snake_case_name}
              </Tag>
            </div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <AutorunActionsMenu autorun={autorun} />
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
        <StatusChip status={autorun.status} />
        {autorun.recording === true ? <Tag accent>REC</Tag> : null}
      </div>

      <dl className="flex flex-col gap-2">
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Window</dt>
          <dd>
            {formatDateTime(autorun.start_time)}
            <span aria-hidden="true">{" → "}</span>
            {formatDateTime(autorun.end_time)}
            <span className="text-dim"> stored UTC</span>
          </dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Countdown</dt>
          <dd>
            {countdown === null ? (
              <span className="text-dim">—</span>
            ) : (
              <span className="flex items-center gap-3" style={{ gap: "var(--s-1)" }}>
                <IconClock size={14} />
                {countdown}
              </span>
            )}
          </dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Resolver → Engine</dt>
          <dd>
            {resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)}
            <span className="text-dim" aria-hidden="true">
              {" → "}
            </span>
            {resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)}
          </dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Profile</dt>
          <dd>{resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)}</dd>
        </div>
        {__ADMIN__ ? (
          <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
            <dt>Owner</dt>
            <dd className="mono">{owner !== undefined && owner !== "" ? owner : "—"}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  )
}

export function AutorunsListView() {
  const queryClient = useQueryClient()
  const [tokens, setTokens] = useState<readonly FilterToken[]>(() => [...DEFAULT_FILTER])
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkProfileOpen, setBulkProfileOpen] = useState(false)
  const selection = useSelection<number>()
  const names = useNameMaps()
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
    void loadAll().catch(() => undefined)
  }, [autoExhaust, hasMore, loadingAll, isFetching, loadAll])

  const matchesRow = useCallback(
    (autorun: Autorun) => {
      if (!matchesFilter(autorun.status, tokens)) return false
      const term = search.trim().toLowerCase()
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
    },
    [tokens, search],
  )

  const rows = useMemo(
    () => [...list.items.filter(matchesRow)].sort(bySoonest),
    [list.items, matchesRow],
  )

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

  const bulkSetProfile = useMutation({
    mutationFn: async ({ ids, profileId }: { ids: readonly number[]; profileId: number }) => {
      // Sequential so a large selection cannot stampede the single-writer DB;
      // a per-id failure (a spent or live autorun) is counted, not fatal.
      const failed: number[] = []
      for (const id of ids) {
        try {
          await updateAutorun(id, { profile_id: profileId })
        } catch {
          failed.push(id)
        }
      }
      return { updated: ids.length - failed.length, skipped: failed.length }
    },
    onSuccess: ({ updated, skipped }) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      if (skipped === 0) {
        toast.success("Profile set", `${updated} scheduled recording${updated === 1 ? "" : "s"} updated`)
      } else if (updated === 0) {
        toast.error("Profile not set", `${skipped} skipped — they have already run or are live`)
      } else {
        toast.success("Profile partly set", `${updated} updated, ${skipped} skipped`)
      }
      selection.clear()
      setBulkProfileOpen(false)
    },
    onError: (error) => toast.error("Could not set the profile", getErrorMessage(error, "Request failed")),
  })

  const selectAllRows = async () => {
    const all = list.hasMore ? await list.loadAll() : list.items
    selection.setMany(all.filter(matchesRow).map((autorun) => autorun.id))
  }

  // Shared by the table header and the card list head, which are never both shown.
  const selectAllCheckbox = (
    <Checkbox
      aria-label="Select all scheduled recordings"
      checked={selection.allSelected(rowIds)}
      onChange={(event) => {
        if (!event.target.checked) {
          selection.clear()
          return
        }
        void selectAllRows()
      }}
    />
  )

  const toggleToken = (token: FilterToken) => {
    selection.clear()
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
      description="Scheduled recordings, soonest first. A scheduled recording runs once at its start time and then retires — status filtering and search apply to the rows loaded so far."
      actions={
        <Button variant="primary" className="max-sm:hidden" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          New scheduled recording
        </Button>
      }
    >
      <Fab label="New scheduled recording" icon={<IconPlus size={22} />} onClick={() => setCreateOpen(true)} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-3">
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
        <div className="flex-1" />
        <div className="relative flex-1 min-w-[200px] max-w-[340px] [&_input]:pl-8">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true">
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
              <div className="table-desktop block max-sm:hidden">
                <Table>
                  <thead>
                    <tr>
                      <Th className="cell-check">{selectAllCheckbox}</Th>
                      <Th>Status</Th>
                      <Th>Scheduled recording</Th>
                      <Th>Window</Th>
                      <Th>Countdown</Th>
                      <Th>Resolver → Engine</Th>
                      <Th>Profile</Th>
                      <Th>Rec</Th>
                      {__ADMIN__ ? <Th>Owner</Th> : null}
                      <Th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((autorun) => (
                      <AutorunRow
                        key={autorun.id}
                        autorun={autorun}
                        names={names}
                        now={now}
                        selected={selection.has(autorun.id)}
                        onToggle={selection.toggle}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="cards-mobile hidden max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:p-3">
                <div className="flex items-center gap-3 px-1">
                  {selectAllCheckbox}
                  <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
                    {rows.length} scheduled recording{rows.length === 1 ? "" : "s"}
                  </span>
                </div>
                {rows.map((autorun) => (
                  <AutorunCard
                    key={autorun.id}
                    autorun={autorun}
                    names={names}
                    now={now}
                    selected={selection.has(autorun.id)}
                    onToggle={selection.toggle}
                  />
                ))}
              </div>
            </PanelBody>
          </Panel>
          {selection.count > 0 ? (
            <BulkBar count={selection.count} onClear={selection.clear}>
              <Button
                size="sm"
                variant="outline"
                icon={<IconProfiles size={15} />}
                onClick={() => setBulkProfileOpen(true)}
              >
                Set profile
              </Button>
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

      <AutorunBulkProfileDialog
        open={bulkProfileOpen}
        onClose={() => setBulkProfileOpen(false)}
        count={selection.count}
        busy={bulkSetProfile.isPending}
        onApply={(profileId) => bulkSetProfile.mutate({ ids: [...selection.selected], profileId })}
      />

      <AutorunFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
