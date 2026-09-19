/**
 * V3 — the sessions list (home).
 *
 * Contract: `docs/web-frontend-spec.md` L263-L273 (columns, states, "New
 * session"), L145-L147/L214-L218 (stop/toggle/delete pending semantics, the
 * 502/504 "Control unavailable" banner, the 10s Stop → hard-delete offer),
 * L197-L213 (row actions come only from `sessionActionsFor`) and L138-L140
 * (infinite list, 30s polling backstop, loaded-rows-only filtering).
 *
 * WS-driven inserts/patches/removes are applied to the cached list by the
 * entity store (`src/lib/entity-store.ts`); real sockets land in Wave 3.
 */
import { useQuery } from "@tanstack/react-query"
import { Plus, Video } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog"
import { SaveAsProfileDialog } from "@/components/sessions/SaveAsProfileDialog"
import { SessionRowActions } from "@/components/sessions/SessionRowActions"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState, EMPTY_STATES } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { SkeletonRows, SKELETON_PRESETS } from "@/components/ui/SkeletonRows"
import { StatusChip } from "@/components/ui/StatusChip"
import { Table, type TableColumn } from "@/components/ui/Table"
import { useAutoLoadOnIntersect } from "@/hooks/use-auto-load"
import { useInfiniteList } from "@/hooks/use-infinite-list"
import { useNameMap } from "@/hooks/use-name-map"
import { getAuthState } from "@/lib/auth-store"
import type { EntityStore, PendingAction } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import { formatRelativeTime, formatSessionDuration } from "@/lib/format"
import { deleteEntity, stopEntity, toggleRecording } from "@/lib/optimistic-policy"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import { engineCanRecord } from "@/lib/schemas/plugins"
import type { Session } from "@/lib/schemas/sessions"
import {
  deleteSession,
  disableSessionRecording,
  enableSessionRecording,
  fetchAllEngines,
  fetchSession,
  fetchSessionsPage,
  stopSession,
} from "@/lib/sessions-api"
import { SESSION_STATUSES, STATUS_MAP, resolveStatus } from "@/lib/status-map"
import { showToast } from "@/lib/toast"

/** Spec L147/L214: no confirmation within ~10s → offer the hard delete. */
export const STOP_ESCALATION_MS = 10_000
/** Spec L216: toggle timeout → refetch `GET /sessions/{id}`. */
export const RECORDING_REFETCH_MS = 10_000

export interface SessionsViewProps {
  readonly store?: EntityStore
}

export function SessionsView({ store = entityStore }: SessionsViewProps) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [stopTarget, setStopTarget] = useState<Session | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null)
  const [saveTarget, setSaveTarget] = useState<Session | null>(null)
  const [controlUnavailable, setControlUnavailable] = useState<ReadonlySet<number>>(new Set())
  const [escalated, setEscalated] = useState<ReadonlySet<number>>(new Set())
  const escalationTimers = useRef(new Map<number, number>())

  const filters = useMemo(
    () => ({
      search: search.trim().length > 0 ? search.trim() : undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
    }),
    [search, statusFilter],
  )

  const list = useInfiniteList<Session>({
    queryKey: queryKeys.sessions(filters),
    fetchPage: fetchSessionsPage,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const { nameFor } = useNameMap()
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines(),
    queryFn: ({ signal }) => fetchAllEngines(signal),
    staleTime: QUERY_STALE_TIMES_MS.engines,
  })
  usePendingVersion(store)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useAutoLoadOnIntersect(sentinelRef, { enabled: list.hasMore, onLoad: list.loadMore })

  useEffect(() => {
    const timers = escalationTimers.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  function removeEscalated(id: number) {
    const timer = escalationTimers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      escalationTimers.current.delete(id)
    }
    setEscalated((previous) => {
      if (!previous.has(id)) return previous
      const next = new Set(previous)
      next.delete(id)
      return next
    })
  }

  function armEscalation(id: number) {
    removeEscalated(id)
    const timer = window.setTimeout(() => {
      escalationTimers.current.delete(id)
      setEscalated((previous) => new Set(previous).add(id))
    }, STOP_ESCALATION_MS)
    escalationTimers.current.set(id, timer)
  }

  function clearControlUnavailable(id: number) {
    setControlUnavailable((previous) => {
      if (!previous.has(id)) return previous
      const next = new Set(previous)
      next.delete(id)
      return next
    })
  }

  async function confirmStop() {
    const session = stopTarget
    setStopTarget(null)
    if (session === null) return

    try {
      await stopEntity(store, {
        resource: "session",
        id: session.id,
        mutate: () => stopSession(session.id),
      })
      clearControlUnavailable(session.id)
      armEscalation(session.id)
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 502 || caught.status === 504)) {
        setControlUnavailable((previous) => new Set(previous).add(session.id))
      } else {
        showToast(userMessageForError(caught))
      }
    }
  }

  async function handleToggleRecording(session: Session) {
    const enabling = session.recording !== true

    try {
      await toggleRecording(store, {
        resource: "session",
        id: session.id,
        optimisticFields: { recording: enabling, status: enabling ? "recording" : "active" },
        mutate: () => (enabling ? enableSessionRecording(session.id) : disableSessionRecording(session.id)),
      })

      window.setTimeout(() => {
        if (store.getPending("session", session.id)?.kind !== "recording-toggle") return
        void fetchSession(session.id)
          .then((fresh) => store.applyAuthoritativeSnapshot("session", fresh.id, { ...fresh }))
          .catch(() => undefined)
      }, RECORDING_REFETCH_MS)
    } catch (caught) {
      showToast(userMessageForError(caught))
    }
  }

  async function confirmDelete() {
    const session = deleteTarget
    setDeleteTarget(null)
    if (session === null) return

    clearControlUnavailable(session.id)
    removeEscalated(session.id)
    try {
      await deleteEntity(store, {
        resource: "session",
        id: session.id,
        mutate: () => deleteSession(session.id),
      })
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) showToast("Cannot delete while remuxing")
      else showToast(userMessageForError(caught))
    }
  }

  const filterActive = filters.search !== undefined || filters.status !== undefined
  const filteredRows = useMemo(() => {
    return list.rows.filter((row) => {
      if (filters.status !== undefined && resolveStatus(row.status).key !== filters.status) return false
      const query = filters.search?.toLowerCase()
      if (query === undefined) return true

      const haystack = [
        String(row.id),
        nameFor("engine", row.engine_id),
        nameFor("resolver", row.resolver_id),
        row.profile_id === null || row.profile_id === undefined ? undefined : nameFor("profile", row.profile_id),
      ]
        .filter((value): value is string => value !== undefined)
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [list.rows, filters, nameFor])

  const isAdmin = getAuthState().user?.role === "admin"
  const now = new Date()

  const columns: TableColumn<Session>[] = [
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusChip status={displayStatusFor(row, store.getPending("session", row.id))} />,
    },
    {
      key: "id",
      header: "ID",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-text-secondary">#{row.id}</span>
          {row.autorun_id === null || row.autorun_id === undefined ? null : (
            <a
              data-testid="autorun-tag"
              href={`/autoruns/${row.autorun_id}`}
              title={`Created by autorun #${row.autorun_id}`}
              className="rounded-pill border border-border px-1.5 text-micro text-text-secondary hover:text-text-primary"
            >
              autorun
            </a>
          )}
        </span>
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
          <NameText
            name={nameFor("resolver", row.resolver_id) ?? row.resolver_name ?? undefined}
            id={row.resolver_id}
          />
        </span>
      ),
    },
    {
      key: "profile",
      header: "Profile",
      render: (row) =>
        row.profile_id === null || row.profile_id === undefined ? (
          <span className="text-text-muted">—</span>
        ) : (
          <a
            data-testid="profile-link"
            href={`/profiles/${row.profile_id}`}
            className="text-accent hover:underline"
          >
            {nameFor("profile", row.profile_id) ?? `#${row.profile_id}`}
          </a>
        ),
    },
    {
      key: "recording",
      header: "Recording",
      render: (row) => <RecordingDot on={displayRecordingFor(row, store.getPending("session", row.id))} />,
    },
    {
      key: "started",
      header: "Started",
      render: (row) => {
        if (row.started_at === null || row.started_at === undefined) return <span className="text-text-muted">—</span>
        try {
          const relative = formatRelativeTime(row.started_at, now)
          return <span title={relative.title}>{relative.text}</span>
        } catch {
          return <span className="text-text-muted">—</span>
        }
      },
    },
    {
      key: "duration",
      header: "Duration",
      render: (row) => {
        if (row.started_at === null || row.started_at === undefined) return <span className="text-text-muted">—</span>
        try {
          return <span>{formatSessionDuration(row.started_at, row.ended_at ?? null, now)}</span>
        } catch {
          return <span className="text-text-muted">—</span>
        }
      },
    },
  ]

  if (isAdmin) {
    columns.push({
      key: "owner",
      header: "Owner",
      render: (row) => <span className="text-text-secondary">{row.requester_user_token ?? "—"}</span>,
    })
  }

  columns.push({
    key: "actions",
    header: "Actions",
    align: "right",
    render: (row) => {
      const pending = store.getPending("session", row.id)
      const engine = enginesQuery.data?.find((item) => item.id === row.engine_id)
      return (
        <SessionRowActions
          session={row}
          canRecord={engineCanRecord(engine)}
          pending={pending}
          escalated={escalated.has(row.id)}
          controlUnavailable={controlUnavailable.has(row.id)}
          onStop={() => setStopTarget(row)}
          onToggleRecording={() => void handleToggleRecording(row)}
          onSaveAsProfile={() => setSaveTarget(row)}
          onDelete={() => setDeleteTarget(row)}
          onForceDelete={() => setDeleteTarget(row)}
        />
      )
    },
  })

  function retry() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(), type: "all" })
  }

  return (
    <main data-testid="sessions-view" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title font-semibold text-text-primary">Sessions</h1>
        <Button
          variant="primary"
          icon={Plus}
          data-testid="new-session-primary"
          onClick={() => setNewSessionOpen(true)}
        >
          New session
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            label="Search"
            placeholder="Search sessions"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="w-48">
          <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {SESSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_MAP[status].label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filterActive && list.hasMore ? (
        <div data-testid="filter-hint" className="flex items-center gap-2 text-small text-text-muted">
          Filter applies to loaded rows
          <Button size="sm" variant="secondary" onClick={list.loadAll} disabled={list.isLoadingAll}>
            Load all
          </Button>
        </div>
      ) : null}

      {list.isInitialLoading ? (
        <SkeletonRows variant={SKELETON_PRESETS.sessions.variant} count={SKELETON_PRESETS.sessions.count} />
      ) : list.isError ? (
        <ErrorPanel
          message={list.error !== null ? userMessageForError(list.error) : "Request failed"}
          onRetry={retry}
        />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={Video}
          title={EMPTY_STATES.sessions}
          action={
            <Button variant="primary" icon={Plus} onClick={() => setNewSessionOpen(true)}>
              New session
            </Button>
          }
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState icon={Video} title="No sessions match the current filter" />
      ) : (
        <Table label="Sessions" columns={columns} rows={filteredRows} getRowKey={(row) => row.id} />
      )}

      <div ref={sentinelRef} aria-hidden="true" />

      <div className="flex items-center justify-between text-small text-text-muted">
        <span>
          Showing {list.loadedCount}
          {filterActive ? ` (${filteredRows.length} matching)` : ""}
        </span>
        {list.hasMore ? (
          <Button size="sm" variant="secondary" onClick={list.loadMore} disabled={list.isLoadingMore}>
            Load more
          </Button>
        ) : null}
      </div>

      <NewSessionDialog open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
      <ConfirmDialog
        open={stopTarget !== null}
        title="Stop session"
        body={`Stop session #${stopTarget?.id ?? ""}? The recording will finalize.`}
        confirmLabel="Stop"
        onConfirm={() => void confirmStop()}
        onCancel={() => setStopTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete session"
        body={`Delete session #${deleteTarget?.id ?? ""}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <SaveAsProfileDialog
        open={saveTarget !== null}
        sessionId={saveTarget?.id ?? null}
        onClose={() => setSaveTarget(null)}
      />
    </main>
  )
}

/** Stop pending renders as `terminating` until the WS snapshot arrives. */
function displayStatusFor(session: Session, pending: PendingAction | undefined): string {
  if (pending?.kind === "stop") return "terminating"
  if (pending?.kind === "recording-toggle") {
    const status = pending.fields?.status
    if (typeof status === "string") return status
  }
  return session.status
}

function displayRecordingFor(session: Session, pending: PendingAction | undefined): boolean {
  if (pending?.kind === "recording-toggle") {
    const recording = pending.fields?.recording
    if (typeof recording === "boolean") return recording
  }
  return session.recording === true
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

/** Re-renders the row actions whenever any pending action changes. */
function usePendingVersion(store: EntityStore): number {
  const [version, setVersion] = useState(0)
  useEffect(() => store.subscribePending(() => setVersion((value) => value + 1)), [store])
  return version
}
