/**
 * V6 — the autorun detail.
 *
 * Contract: `docs/web-frontend-spec.md` L279-L301 and
 * `docs/general-client-specification.md` §5/§13.3/§13.11: header with the
 * status chip, names, countdown and local start/end times; the schedule,
 * recording flag and read-only config panels; the linked-session card from
 * the cached scan (or a `session.created` cache write); and the action set
 * (edit, run-now, save-as-profile on spent, delete with the live warning).
 * The live lock is surfaced here as well as inside the wizard.
 */
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { runAutorunNow } from "@/components/autoruns/run-now"
import { SaveAutorunAsProfileDialog } from "@/components/autoruns/SaveAutorunAsProfileDialog"
import { useLinkedSession } from "@/components/autoruns/use-linked-session"
import { AutorunWizard } from "@/components/autoruns/AutorunWizard"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonRows, SKELETON_PRESETS } from "@/components/ui/SkeletonRows"
import { StatusChip } from "@/components/ui/StatusChip"
import { useCountdownTick } from "@/hooks/use-tick"
import {
  AUTORUN_LIVE_LOCK_MESSAGE,
  isAutorunLiveStatus,
} from "@/lib/autorun-form"
import { deleteAutorun, fetchAutorun } from "@/lib/autoruns-api"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { userMessageForError } from "@/lib/errors"
import { formatCountdown, formatDateTime, formatRelativeTime, localZoneLabel } from "@/lib/format"
import { deleteEntity } from "@/lib/optimistic-policy"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import { autorunActionsFor } from "@/lib/status-map"
import { showToast } from "@/lib/toast"

export interface AutorunDetailViewProps {
  readonly autorunId: number
  readonly store?: EntityStore
}

export function AutorunDetailView({ autorunId, store = entityStore }: AutorunDetailViewProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const tick = useCountdownTick()
  usePendingVersion(store)

  const query = useQuery({
    queryKey: queryKeys.autorun(autorunId),
    queryFn: () => fetchAutorun(autorunId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const linked = useLinkedSession(query.data)

  if (query.isPending) {
    return (
      <main data-testid="autorun-detail" className="flex flex-col gap-4">
        <SkeletonRows variant={SKELETON_PRESETS.sessions.variant} count={3} />
      </main>
    )
  }

  if (query.isError || query.data === undefined) {
    return (
      <main data-testid="autorun-detail" className="flex flex-col gap-4">
        <ErrorPanel
          message={query.error !== null ? userMessageForError(query.error) : "Request failed"}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: queryKeys.autorun(autorunId) })}
        />
      </main>
    )
  }

  const autorun = query.data
  const live = isAutorunLiveStatus(autorun.status)
  const pending = store.getPending("autorun", autorun.id)
  const actions = autorunActionsFor(autorun.status).map((action) => action.id)

  async function confirmDelete() {
    setDeleteOpen(false)
    try {
      await deleteEntity(store, {
        resource: "autorun",
        id: autorun.id,
        mutate: () => deleteAutorun(autorun.id),
      })
    } catch (caught) {
      showToast(userMessageForError(caught))
    }
  }

  let countdown: string | null = null
  try {
    countdown = formatCountdown(autorun.start_time, tick)
  } catch {
    countdown = null
  }

  let startText = "—"
  let startTitle: string | undefined
  try {
    startText = formatDateTime(autorun.start_time)
    startTitle = formatRelativeTime(autorun.start_time, tick).text
  } catch {
    startText = "—"
  }

  let endText = "—"
  try {
    endText = formatDateTime(autorun.end_time)
  } catch {
    endText = "—"
  }

  return (
    <main data-testid="autorun-detail" className="flex flex-col gap-4">
      <a href="/autoruns" className="inline-flex w-fit items-center gap-1 text-small text-text-secondary hover:text-text-primary">
        <ArrowLeft aria-hidden="true" className="size-[var(--icon-row)]" />
        Autoruns
      </a>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StatusChip status={autorun.status} />
            <h1 className="text-title font-semibold text-text-primary">{autorun.user_friendly_name}</h1>
          </div>
          <span className="font-mono text-small text-text-muted">{autorun.snake_case_name}</span>
          <span data-testid="autorun-countdown" className="text-small text-text-secondary">
            {countdown ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {actions.includes("edit") ? (
            <Button data-testid="autorun-detail-edit" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : null}
          {actions.includes("run-now") ? (
            <Button data-testid="autorun-detail-run-now" onClick={() => void runAutorunNow(store, autorun)}>
              Run now
            </Button>
          ) : null}
          {actions.includes("save-as-profile") ? (
            <Button data-testid="autorun-detail-save-as-profile" onClick={() => setSaveOpen(true)}>
              Save as profile
            </Button>
          ) : null}
          {actions.includes("delete") ? (
            <Button
              data-testid="autorun-detail-delete"
              variant="danger"
              disabled={pending?.kind === "delete"}
              onClick={() => setDeleteOpen(true)}
            >
              {pending?.kind === "delete" ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 aria-hidden="true" className="size-[var(--icon-row)] animate-spin" />
                  Deleting…
                </span>
              ) : (
                "Delete"
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {live ? (
        <p data-testid="autorun-live-lock-panel" role="status" className="rounded-control border border-warn px-3 py-2 text-small text-warn">
          {AUTORUN_LIVE_LOCK_MESSAGE}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section data-testid="schedule-panel" className="flex flex-col gap-2 rounded-surface border border-border p-3">
          <h2 className="text-label font-medium text-text-primary">Schedule</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-body">
            <dt className="text-text-muted">Start</dt>
            <dd title={startTitle}>
              {startText} <span className="text-text-muted">({localZoneLabel(new Date())})</span>
            </dd>
            <dt className="text-text-muted">End</dt>
            <dd>{endText}</dd>
            <dt className="text-text-muted">Recording</dt>
            <dd>{autorun.recording === true ? "On" : "Off"}</dd>
            <dt className="text-text-muted">Kind</dt>
            <dd>One-off — not recurring</dd>
          </dl>
        </section>

        <section data-testid="config-panel" className="flex flex-col gap-2 rounded-surface border border-border p-3">
          <h2 className="text-label font-medium text-text-primary">Configuration</h2>
          <pre data-testid="autorun-config-json" className="overflow-x-auto font-mono text-small text-text-secondary">
            {JSON.stringify(
              {
                engine_id: autorun.engine_id,
                resolver_id: autorun.resolver_id,
                resolver_config: autorun.resolver_config ?? {},
                retry_mode: autorun.retry_mode ?? "none",
                retry_config: autorun.retry_config ?? {},
              },
              null,
              2,
            )}
          </pre>
        </section>
      </div>

      {linked !== undefined ? (
        <section
          data-testid="linked-session-card"
          className="flex items-center gap-3 rounded-surface border border-border p-3"
        >
          <h2 className="text-label font-medium text-text-primary">Linked session</h2>
          <StatusChip status={linked.status} />
          <a data-testid="linked-session-link" href={`/sessions/${linked.id}`} className="text-accent hover:underline">
            #{linked.id}
          </a>
          {linked.attempts !== undefined && linked.attempts !== null ? (
            <span className="text-small text-text-muted">{linked.attempts.length} attempts</span>
          ) : null}
        </section>
      ) : live ? (
        <p data-testid="linked-session-empty" className="text-small text-text-muted">
          Waiting for the scheduled session…
        </p>
      ) : null}

      <AutorunWizard open={editOpen} autorun={autorun} onClose={() => setEditOpen(false)} />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete autorun"
        body={
          live ? (
            <span data-testid="live-delete-warning">A recording is running — deleting will stop and delete it</span>
          ) : (
            `Delete autorun "${autorun.user_friendly_name}"? This cannot be undone.`
          )
        }
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
      <SaveAutorunAsProfileDialog open={saveOpen} autorunId={autorun.id} onClose={() => setSaveOpen(false)} />
    </main>
  )
}

/** Re-renders the header whenever any pending action changes. */
function usePendingVersion(store: EntityStore): number {
  const [version, setVersion] = useState(0)
  useEffect(() => store.subscribePending(() => setVersion((value) => value + 1)), [store])
  return version
}
