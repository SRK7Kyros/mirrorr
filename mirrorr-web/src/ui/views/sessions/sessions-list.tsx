import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteSession,
  getErrorMessage,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
} from "@/api"
import { fetchSessionPage } from "@/api/endpoints"
import { queryKeys, queryRoots } from "@/api/query-keys"
import {
  matchesFilter,
  shouldAutoExhaust,
  type FilterToken,
} from "@/api/domain/filter-grammar"
import { formatBytes, parseNaiveUtc } from "@/api/time"
import { diskTone, liveReadout, nextRunReadout } from "@/api/domain/ops"
import { rankBySearch } from "@/api/domain/search"
import { useOverview } from "@/api/hooks"
import { useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import { sessionTitle } from "./session-title"
import type { Session } from "@/api/schemas"
import {
  BulkBar,
  Button,
  buttonClass,
  CardGrid,
  CardGridSkeleton,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Fab,
  FilterSegmented,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSessions,
  IconTrash,
  Input,
  LoadMore,
  PageToolbar,
  QueryState,
  Select,
  StatLine,
  TimeZoneNote,
  toast,
} from "@/ui/components"
import { useDebouncedValue, useScopedSelection } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { NewSessionDialog } from "./new-session-dialog"
import { SessionCard } from "./session-card"

/**
 * The filter is single-select: `All` · `Live` · `Finished`. Sessions are never
 * `scheduled` (only `AutorunStatus` has that member in core), so the shared
 * `FILTER_TOKENS` member is not offered here.
 */
const FILTER_ITEMS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "spent", label: "Finished" },
] as const satisfies readonly { id: FilterToken; label: string }[]

type SortKey = "newest" | "oldest" | "name"

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name (A–Z)",
}

const sessionSearchFields = (session: Session): readonly string[] => [
  String(session.id),
  session.profile_name ?? "",
  session.engine_name ?? "",
  session.resolver_name ?? "",
  session.status,
]

/** Epoch ms of `started_at`, or `null` for a run that never started (sorts last). */
function startedAtMs(session: Session): number | null {
  if (session.started_at == null || session.started_at === "") return null
  const parsed = parseNaiveUtc(session.started_at).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function byStarted(a: Session, b: Session, direction: "newest" | "oldest"): number {
  const left = startedAtMs(a)
  const right = startedAtMs(b)
  if (left === null || right === null) {
    if (left === right) return b.id - a.id
    return left === null ? 1 : -1
  }
  if (left !== right) return direction === "newest" ? right - left : left - right
  return direction === "newest" ? b.id - a.id : a.id - b.id
}

const TONE_CLASS = {
  normal: "",
  warning: "text-warning",
  danger: "text-danger",
} as const

/**
 * One labelled reading inside the ops line. `StatLine` spaces its items but not
 * the parts of one item, so the label and its numbers are grouped here — without
 * this the band reads `Live3` and `Disk free60.0 GB`.
 */
function OpsItem({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <span>{label}</span>
      {children}
    </span>
  )
}

/**
 * The ops band, as one line (§2.2a `StatLine`). It renders in every state —
 * including a failed overview request — because an empty band is indistinguishable
 * from "nothing is running", which is a different claim.
 */
function OpsLine() {
  const overview = useOverview()
  const data = overview.data

  if (overview.isError) {
    return (
      <div data-testid="ops-strip">
        <StatLine items={["Ops numbers unavailable — the overview request failed"]} />
      </div>
    )
  }

  if (data === undefined) {
    return (
      <div data-testid="ops-strip">
        <StatLine items={["Loading ops numbers…"]} label="Loading ops numbers" />
      </div>
    )
  }

  const live = liveReadout(data.sessions)
  const next = nextRunReadout(data.next_autorun)
  const failed = data.sessions.failed_24h
  const disk = data.disk ?? null
  const total = data.sessions.total

  return (
    <div data-testid="ops-strip">
      <StatLine
        label="Ops numbers"
        items={[
          `${total} session${total === 1 ? "" : "s"} in account`,
          <OpsItem label="Live">
            <span className="tabular-nums">{live.live}</span>
            {live.notes.length === 0 ? null : (
              <span className="text-dim">{live.notes.join(" · ")}</span>
            )}
          </OpsItem>,
          <OpsItem label="Failed in 24 h">
            <span className={failed > 0 ? TONE_CLASS.warning : undefined}>{failed}</span>
          </OpsItem>,
          <OpsItem label="Disk free">
            {disk === null ? (
              <span className="text-dim">—</span>
            ) : (
              <>
                <span className={TONE_CLASS[diskTone(disk.free_bytes)]}>
                  {formatBytes(disk.free_bytes)}
                </span>
                <span className="text-dim">{formatBytes(disk.total_bytes)} total</span>
              </>
            )}
          </OpsItem>,
          <OpsItem label="Next schedule">
            {next === null ? (
              <span className="text-dim">none pending</span>
            ) : (
              <>
                <Link
                  className="truncate text-ink"
                  to="/autoruns/$autorunId"
                  params={{ autorunId: String(data.next_autorun?.id ?? "") }}
                  title={next.name}
                >
                  {next.name}
                </Link>
                <span className="text-dim">{next.countdown}</span>
              </>
            )}
          </OpsItem>,
        ]}
      />
    </div>
  )
}

/**
 * Sessions — one card per capture run. The page owns the toolbar, the query gate
 * and the selection; the card owns its six slots (`session-card.tsx`). Nothing
 * here re-derives a run's state: the chip, the hero and the plate all come from
 * the record through `deriveRunState()`.
 */
export function SessionsListView() {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<FilterToken>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("newest")
  const [selectMode, setSelectMode] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const term = useDebouncedValue(search, 250)
  const names = useNameMaps()

  const list = useEntityList<Session>({
    queryKey: queryKeys.sessions({ filter: token, q: term }),
    fetchPage: (cursor) => fetchSessionPage(cursor, undefined, { q: term }),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list
  const autoExhaust = shouldAutoExhaust([token])

  // Non-`all` filters are a client-side scope over the whole (small) set.
  useEffect(() => {
    if (!autoExhaust || !hasMore || loadingAll || isFetching) return
    void loadAll().catch(() => undefined)
  }, [autoExhaust, hasMore, loadingAll, isFetching, loadAll])

  // The filter is a hard scope; the search term only ranks what is left, so the
  // chosen sort stays the tie-break.
  const rows = useMemo(() => {
    const scoped = list.items.filter((session) => matchesFilter(session.status, [token]))
    const ordered = [...scoped].sort((a, b) =>
      sort === "name"
        ? sessionTitle(a, names).localeCompare(sessionTitle(b, names)) || a.id - b.id
        : byStarted(a, b, sort),
    )
    return rankBySearch(ordered, search, sessionSearchFields)
  }, [list.items, token, sort, search, names])

  const rowIds = useMemo(() => rows.map((session) => session.id), [rows])
  // Selection is scoped to the cards on screen: a filter or a narrower search
  // drops the ids it hides, so "Delete 4 selected" can never mean two you
  // cannot see.
  const selection = useScopedSelection(rowIds)

  const selectedSessions = rows.filter((session) => selection.has(session.id))
  const selectedIds = selectedSessions.map((session) => session.id)
  const access = useBulkAccessAction(
    "session",
    selectedSessions.map((session) => ({ id: session.id, label: sessionTitle(session, names) })),
  )

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      const deleted: number[] = []
      const failed: number[] = []
      for (const id of ids) {
        try {
          await deleteSession(id)
          deleted.push(id)
        } catch {
          failed.push(id)
        }
      }
      return { deleted, failed }
    },
    onSuccess: ({ deleted, failed }) => {
      for (const id of deleted) {
        removeFromInfiniteLists(queryClient, queryRoots.sessions, id)
        queryClient.removeQueries({ queryKey: queryKeys.session(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      if (failed.length === 0) {
        toast.success("Sessions deleted", `${deleted.length} removed`)
      } else if (deleted.length === 0) {
        toast.error("Nothing was deleted", `${failed.length} could not be removed`)
      } else {
        toast.success("Sessions partly deleted", `${deleted.length} removed, ${failed.length} skipped`)
      }
      selection.setMany(failed)
    },
    onError: (error) =>
      toast.error(
        "Could not delete the sessions",
        getErrorMessage(error, "Request failed"),
      ),
  })

  const changeFilter = (next: FilterToken) => {
    setToken(next)
    selection.clear()
  }

  const changeSort = (next: SortKey) => {
    setSort(next)
    selection.clear()
  }

  const toggleSelectMode = () => {
    setSelectMode((current) => {
      if (current) selection.clear()
      return !current
    })
  }

  const allSelected = selection.allSelected(rowIds)
  const someSelected = selection.someSelected(rowIds)
  const noSessionsAtAll = list.items.length === 0 && term.trim() === ""

  return (
    <Page
      title="Sessions"
      description="Live and recent capture runs, newest first. Search reaches the whole history; the status filter scopes it."
      actions={
        <Button
          variant="primary"
          className="max-sm:hidden"
          icon={<IconPlus size={16} />}
          onClick={() => setCreateOpen(true)}
        >
          New session
        </Button>
      }
    >
      <Fab
        label="New session"
        icon={<IconPlus size={22} />}
        onClick={() => setCreateOpen(true)}
      />

      <OpsLine />

      <PageToolbar
        filters={
          <FilterSegmented
            items={FILTER_ITEMS}
            value={token}
            onChange={changeFilter}
            ariaLabel="Filter by status"
          />
        }
        search={
          <div className="relative [&_input]:pl-8">
            <span
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            >
              <IconSearch size={15} />
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by id, profile, engine, status…"
              aria-label="Filter sessions"
            />
          </div>
        }
        sort={
          <Select
            value={sort}
            aria-label="Sort sessions"
            onChange={(event) => {
              const next = event.target.value
              changeSort(next === "oldest" || next === "name" ? next : "newest")
            }}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </Select>
        }
        count={
          <>
            {rows.length} session{rows.length === 1 ? "" : "s"}
            {selection.outside > 0 ? (
              <span className="text-dim"> · {selection.outside} outside this filter</span>
            ) : null}
          </>
        }
        select={
          <>
            {selectMode ? (
              <Checkbox
                aria-label="Select all sessions"
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={(event) => {
                  if (event.target.checked) selection.setMany(rowIds)
                  else selection.clear()
                }}
              />
            ) : null}
            <Button
              size="sm"
              variant={selectMode ? "secondary" : "ghost"}
              aria-pressed={selectMode}
              onClick={toggleSelectMode}
            >
              Select
            </Button>
          </>
        }
        refresh={
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefresh size={15} />}
            loading={isFetching}
            onClick={list.refetch}
          >
            Refresh
          </Button>
        }
        note={<TimeZoneNote />}
      />

      <QueryState
        query={list}
        loading={<CardGridSkeleton label="Loading sessions" />}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<IconSessions size={22} />}
            title={
              noSessionsAtAll
                ? "No sessions yet."
                : term.trim() !== ""
                  ? `No session matches “${term.trim()}”.`
                  : "Nothing matches this filter"
            }
            text={
              noSessionsAtAll
                ? "A session is one capture run. Start one from a profile, or build the config by hand."
                : term.trim() !== ""
                  ? "The search covers every session in the account, whatever page it lives on."
                  : "Widen the status filter or clear the search box."
            }
            action={
              noSessionsAtAll || term.trim() !== "" ? (
                <div className="flex items-center gap-3">
                  {term.trim() === "" ? null : (
                    <Button variant="secondary" onClick={() => setSearch("")}>
                      Clear search
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    icon={<IconPlus size={16} />}
                    onClick={() => setCreateOpen(true)}
                  >
                    New session
                  </Button>
                  <Link className={buttonClass({ variant: "secondary" })} to="/profiles">
                    Open profiles
                  </Link>
                </div>
              ) : undefined
            }
          />
        }
        errorMessage="Could not load sessions"
        onRetry={list.refetch}
      >
        <CardGrid rowHeight={330} label="Sessions" className="session-grid">
          {rows.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              names={names}
              selected={selection.has(session.id)}
              selectMode={selectMode}
              onToggle={selection.toggle}
            />
          ))}
        </CardGrid>

        {selection.count > 0 ? (
          <BulkBar
            nextToFab
            count={selectedIds.length}
            onClear={selection.clear}
            actions={[
              ...(access.action === null ? [] : [access.action]),
              {
                key: "delete",
                label: "Delete selected",
                icon: <IconTrash size={15} />,
                danger: true,
                loading: bulkRemove.isPending,
                onClick: () => setBulkDeleteOpen(true),
              },
            ]}
          />
        ) : null}
        {access.dialog}
        <LoadMore
          hasMore={hasMore}
          isFetching={isFetching}
          onLoadMore={list.loadMore}
          onLoadAll={() => void loadAll().catch(() => undefined)}
          loadingAll={loadingAll}
          count={rows.length}
        />
      </QueryState>

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selectedIds.length} selected session${selectedIds.length === 1 ? "" : "s"}?`}
        description="A running session stops being tracked; recordings already on disk are not removed."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync(selectedIds)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />

      <NewSessionDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
