/**
 * V5 — the autoruns list.
 *
 * Contract: `docs/web-frontend-spec.md` L279-L301 and
 * `docs/general-client-specification.md` §5 / §13.11.1:
 * - `?filter=` is the `+`-joined grammar (default `scheduled+live`, spent
 *   separated, unknown tokens dropped, empty → `all`); filtering is
 *   client-side over loaded pages and a non-`all` filter auto-exhausts
 *   pagination;
 * - columns: Status · Name (friendly + mono snake_case) · Engine → Resolver ·
 *   Start · End · Recording · Countdown · Actions; spent rows at 60% opacity;
 * - the countdown line recomputes on the 10s tick;
 * - actions: edit, run-now (composed `POST /sessions/`, never a run endpoint),
 *   save-as-profile on spent, delete with the live warning, and the
 *   status-independent Export download (todo 23).
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, Plus } from "lucide-react"
import { AutorunRowActions } from "@/components/autoruns/AutorunRowActions"
import { runAutorunNow } from "@/components/autoruns/run-now"
import { AutorunWizard } from "@/components/autoruns/AutorunWizard"
import { SaveAutorunAsProfileDialog } from "@/components/autoruns/SaveAutorunAsProfileDialog"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState, EMPTY_STATES } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonRows, SKELETON_PRESETS } from "@/components/ui/SkeletonRows"
import { StatusChip } from "@/components/ui/StatusChip"
import { Table, type TableColumn } from "@/components/ui/Table"
import { useAutoLoadOnIntersect } from "@/hooks/use-auto-load"
import { useInfiniteList } from "@/hooks/use-infinite-list"
import { usePollingPolicy } from "@/hooks/use-polling-policy"
import { useNameMap } from "@/hooks/use-name-map"
import { useCountdownTick } from "@/hooks/use-tick"
import {
  AUTORUN_FILTER_LABELS,
  AUTORUN_FILTER_TOKENS,
  autorunMatchesFilter,
  isSpentAutorun,
  parseAutorunFilter,
  shouldAutoExhaustAutoruns,
  toggleAutorunFilterToken,
  type AutorunFilterToken,
} from "@/lib/autorun-filters"
import { deleteAutorun, fetchAutorunsPage } from "@/lib/autoruns-api"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { userMessageForError } from "@/lib/errors"
import { formatCountdown, formatRelativeTime } from "@/lib/format"
import { isAutorunLiveStatus } from "@/lib/autorun-form"
import { deleteEntity } from "@/lib/optimistic-policy"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import type { Autorun } from "@/lib/schemas/autoruns"
import { showToast } from "@/lib/toast"

export interface AutorunsViewProps {
  /** Raw `?filter=` value; the route owns the search param. */
  readonly filter?: string
  readonly onFilterChange?: (next: string) => void
  readonly store?: EntityStore
}

export function AutorunsView({ filter, onFilterChange, store = entityStore }: AutorunsViewProps) {
  const [internalFilter, setInternalFilter] = useState<string | undefined>(filter)
  const [newOpen, setNewOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Autorun | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Autorun | null>(null)
  const [saveTarget, setSaveTarget] = useState<Autorun | null>(null)

  const filterValue = filter ?? internalFilter
  const setFilter = onFilterChange ?? setInternalFilter
  const parsed = useMemo(() => parseAutorunFilter(filterValue), [filterValue])
  const tick = useCountdownTick()
  usePendingVersion(store)

  const polling = usePollingPolicy("list")
  const list = useInfiniteList<Autorun>({
    queryKey: queryKeys.autoruns(),
    fetchPage: fetchAutorunsPage,
    refetchInterval: polling.refetchInterval,
    refetchOnWindowFocus: polling.refetchOnWindowFocus,
  })
  const { nameFor } = useNameMap()

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useAutoLoadOnIntersect(sentinelRef, { enabled: list.hasMore, onLoad: list.loadMore })

  // L285: a non-`all` filter auto-exhausts pagination so the filtered set is
  // complete before it is rendered.
  const { hasMore, isLoadingAll, loadAll } = list
  useEffect(() => {
    if (shouldAutoExhaustAutoruns(parsed) && hasMore && !isLoadingAll) loadAll()
  }, [parsed, hasMore, isLoadingAll, loadAll])

  const rows = useMemo(
    () => list.rows.filter((row) => autorunMatchesFilter(row.status, parsed)),
    [list.rows, parsed],
  )

  async function confirmDelete() {
    const target = deleteTarget
    setDeleteTarget(null)
    if (target === null) return
    try {
      await deleteEntity(store, {
        resource: "autorun",
        id: target.id,
        mutate: () => deleteAutorun(target.id),
      })
    } catch (caught) {
      showToast(userMessageForError(caught))
    }
  }

  const columns: TableColumn<Autorun>[] = [
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusChip status={row.status} />,
    },
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-text-primary">{row.user_friendly_name}</span>
          <span className="font-mono text-micro text-text-muted">{row.snake_case_name}</span>
        </div>
      ),
    },
    {
      key: "configuration",
      header: "Engine → Resolver",
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          <NameText name={nameFor("engine", row.engine_id) ?? row.engine_name ?? undefined} id={row.engine_id} />
          <span aria-hidden="true" className="text-text-muted">
            →
          </span>
          <NameText name={nameFor("resolver", row.resolver_id) ?? row.resolver_name ?? undefined} id={row.resolver_id} />
        </span>
      ),
    },
    {
      key: "start",
      header: "Start",
      render: (row) => {
        try {
          const relative = formatRelativeTime(row.start_time, tick)
          return <span title={relative.title}>{relative.text}</span>
        } catch {
          return <span className="text-text-muted">—</span>
        }
      },
    },
    {
      key: "end",
      header: "End",
      render: (row) => {
        try {
          const relative = formatRelativeTime(row.end_time, tick)
          return <span title={relative.title}>{relative.text}</span>
        } catch {
          return <span className="text-text-muted">—</span>
        }
      },
    },
    {
      key: "recording",
      header: "Recording",
      render: (row) => <RecordingDot on={row.recording === true} />,
    },
    {
      key: "countdown",
      header: "Countdown",
      render: (row) => {
        let text: string | null = null
        try {
          text = formatCountdown(row.start_time, tick)
        } catch {
          text = null
        }
        return (
          <span data-testid={`autorun-countdown-${row.id}`} className="text-text-secondary">
            {text ?? "—"}
          </span>
        )
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => (
        <AutorunRowActions
          autorun={row}
          pending={store.getPending("autorun", row.id)}
          onEdit={() => setEditTarget(row)}
          onRunNow={() => void runAutorunNow(store, row)}
          onSaveAsProfile={() => setSaveTarget(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
    },
  ]

  function retry() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.autoruns(), type: "all" })
  }

  const liveDelete = deleteTarget !== null && isAutorunLiveStatus(deleteTarget.status)

  return (
    <main data-testid="autoruns-view" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title font-semibold text-text-primary">Autoruns</h1>
        <Button variant="primary" icon={Plus} data-testid="new-autorun-primary" onClick={() => setNewOpen(true)}>
          New autorun
        </Button>
      </div>

      <div role="group" aria-label="Filter autoruns" className="flex items-center gap-1">
        {AUTORUN_FILTER_TOKENS.map((token) => {
          const active = parsed.isAll ? token === "all" : parsed.tokens.has(token)
          return (
            <button
              key={token}
              type="button"
              aria-pressed={active}
              data-testid={`autorun-filter-${token}`}
              onClick={() => setFilter(toggleAutorunFilterToken(parsed, token as AutorunFilterToken))}
              className={[
                "h-6 rounded-control border px-2 text-small transition-colors duration-[var(--motion-fast)] ease-out",
                active
                  ? "border-accent bg-accent text-bg-base"
                  : "border-border text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {AUTORUN_FILTER_LABELS[token]}
            </button>
          )
        })}
      </div>

      {list.isInitialLoading ? (
        <SkeletonRows variant={SKELETON_PRESETS.sessions.variant} count={SKELETON_PRESETS.sessions.count} />
      ) : list.isError ? (
        <ErrorPanel message={list.error !== null ? userMessageForError(list.error) : "Request failed"} onRetry={retry} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={EMPTY_STATES.autoruns}
          action={
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
              New autorun
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No autoruns match the current filter" />
      ) : (
        <Table
          label="Autoruns"
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          getRowClassName={(row) => (isSpentAutorun(row.status) ? "opacity-60" : undefined)}
        />
      )}

      <div ref={sentinelRef} aria-hidden="true" />

      <div className="flex items-center justify-between text-small text-text-muted">
        <span>
          Showing {list.loadedCount}
          {parsed.isAll ? "" : ` (${rows.length} matching)`}
        </span>
        {list.hasMore && !shouldAutoExhaustAutoruns(parsed) ? (
          <Button size="sm" variant="secondary" onClick={list.loadMore} disabled={list.isLoadingMore}>
            Load more
          </Button>
        ) : null}
      </div>

      <AutorunWizard open={newOpen} onClose={() => setNewOpen(false)} />
      <AutorunWizard open={editTarget !== null} autorun={editTarget} onClose={() => setEditTarget(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete autorun"
        body={
          liveDelete ? (
            <span data-testid="live-delete-warning">
              A recording is running — deleting will stop and delete it
            </span>
          ) : (
            `Delete autorun "${deleteTarget?.user_friendly_name ?? ""}"? This cannot be undone.`
          )
        }
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <SaveAutorunAsProfileDialog
        open={saveTarget !== null}
        autorunId={saveTarget?.id ?? null}
        onClose={() => setSaveTarget(null)}
      />
    </main>
  )
}

function NameText({ name, id }: { readonly name: string | undefined; readonly id: number }) {
  if (name !== undefined) return <span className="text-text-secondary">{name}</span>
  return <span className="text-text-muted">#{id}</span>
}

function RecordingDot({ on }: { readonly on: boolean }) {
  const label = on ? "Recording on" : "Recording off"
  return (
    <span
      data-testid="recording-dot"
      role="img"
      aria-label={label}
      title={label}
      className={["inline-block size-1.5 rounded-pill", on ? "bg-ok" : "bg-neutral"].join(" ")}
    />
  )
}

/** Re-renders the rows whenever any pending action changes. */
function usePendingVersion(store: EntityStore): number {
  const [version, setVersion] = useState(0)
  useEffect(() => store.subscribePending(() => setVersion((value) => value + 1)), [store])
  return version
}
