/**
 * V4 — the session detail / live monitor.
 *
 * Contract: `docs/web-frontend-spec.md` L267-L277 (V4 layout: header, Live
 * URLs panel, attempts timeline, remux progress, recording, read-only config),
 * L179-L193 (WS cache reactions + the 10s remux fallback) and L141-L150 /
 * §13.4 of the client contract (delete never offered while remuxing/finalizing;
 * a 204 is not "gone" — the view holds "Deleting…" until `session.deleted` or
 * the 15s poll fallback observes the removal).
 *
 * No player and no scrubbing affordance exists here by design: `session_urls`
 * links open externally, and a recording is never embedded (contract §13.11.5).
 */
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Loader2, Save, Square, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AttemptsTimeline } from "@/components/sessions/AttemptsTimeline"
import { LiveUrlsPanel } from "@/components/sessions/LiveUrlsPanel"
import { RemuxProgressCard } from "@/components/sessions/RemuxProgressCard"
import { SaveAsProfileDialog } from "@/components/sessions/SaveAsProfileDialog"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonRows } from "@/components/ui/SkeletonRows"
import { StatusChip } from "@/components/ui/StatusChip"
import { Switch } from "@/components/ui/Switch"
import { getAuthState } from "@/lib/auth-store"
import type { EntityStore, PendingAction } from "@/lib/entity-store"
import { useLiveDurationTick } from "@/hooks/use-tick"
import { useNameMap } from "@/hooks/use-name-map"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, UNEXPECTED_RESPONSE_MESSAGE, userMessageForError } from "@/lib/errors"
import { formatSessionDuration } from "@/lib/format"
import { deleteEntity, stopEntity, toggleRecording } from "@/lib/optimistic-policy"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import {
  activateRemuxProgress,
  applyRemuxProgressFrame,
  deactivateRemuxProgress,
} from "@/lib/remux-progress"
import { engineCanRecord } from "@/lib/schemas/plugins"
import { isRemuxProgressEvent, subscribeSessionFrames } from "@/lib/session-frames"
import {
  deleteSession,
  disableSessionRecording,
  enableSessionRecording,
  fetchAllEngines,
  fetchSession,
  stopSession,
} from "@/lib/sessions-api"
import { sessionActionsFor } from "@/lib/status-map"
import { showToast } from "@/lib/toast"

/** Spec L141-L150: the delete poll fallback window; the view may stop waiting. */
export const DELETE_POLL_FALLBACK_MS = 15_000
/** A stop that never flips offers the force-delete escalation. */
export const STOP_ESCALATION_MS = 10_000
/** Toggle confirmation refetch (same fallback the list row uses). */
export const RECORDING_REFETCH_MS = 10_000

export interface SessionDetailViewProps {
  readonly sessionId: number
  readonly store?: EntityStore
  /**
   * Router seam. Production defaults to a full-document navigation (the hash
   * router has no programmatic navigation without the plugin routers Wave 3
   * owns); tests and the todo-15 router can inject their own.
   */
  readonly navigateToList?: (to: string) => void
}

function defaultNavigate(to: string): void {
  window.location.assign(to)
}

function pendingString(fields: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = fields?.[key]
  return typeof value === "string" ? value : undefined
}

function pendingBoolean(fields: Readonly<Record<string, unknown>> | undefined, key: string): boolean | undefined {
  const value = fields?.[key]
  return typeof value === "boolean" ? value : undefined
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

function SessionNotFound() {
  return (
    <main data-testid="session-not-found" className="flex flex-col items-start gap-3 py-10">
      <h1 className="text-heading font-semibold text-text-primary">Session not found</h1>
      <a
        data-testid="back-to-sessions"
        href="/sessions"
        className="inline-flex items-center gap-1 text-body text-accent hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-[var(--icon-row)]" />
        Back to sessions
      </a>
    </main>
  )
}

function DetailSkeleton() {
  return (
    <div data-testid="session-detail-skeleton" className="flex flex-col gap-4">
      <div className="h-9 w-96 rounded-control bg-bg-overlay" />
      <SkeletonRows variant="cards" count={2} label="Loading session" />
    </div>
  )
}

function ConfigBlock({
  label,
  value,
  testId,
}: {
  readonly label: string
  readonly value: unknown
  readonly testId: string
}) {
  return (
    <div>
      <h3 className="text-small font-medium text-text-secondary">{label}</h3>
      <pre
        data-testid={testId}
        className="mt-1 overflow-x-auto rounded-control bg-bg-inset p-3 font-mono text-small text-text-primary"
      >
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  )
}

function NameText({ name, id }: { readonly name: string | undefined; readonly id: number }) {
  if (name !== undefined) return <span className="text-text-secondary">{name}</span>
  return <span className="text-text-muted">#{id}</span>
}

/** Re-renders when any pending action changes (same pattern as V3's rows). */
function usePendingAction(store: EntityStore, id: number): PendingAction | undefined {
  const [pending, setPending] = useState(() => store.getPending("session", id))
  useEffect(() => {
    const sync = () => setPending(store.getPending("session", id))
    sync()
    return store.subscribePending(sync)
  }, [store, id])
  return pending
}

export function SessionDetailView({
  sessionId,
  store = entityStore,
  navigateToList = defaultNavigate,
}: SessionDetailViewProps) {
  const valid = Number.isInteger(sessionId) && sessionId > 0
  const [stopOpen, setStopOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [controlUnavailable, setControlUnavailable] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const escalationTimerRef = useRef<number | null>(null)
  const navigatedRef = useRef(false)

  const detailQuery = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
    staleTime: QUERY_STALE_TIMES_MS.session,
    refetchInterval: DELETE_POLL_FALLBACK_MS,
    enabled: valid,
    retry: (failureCount, error) => {
      // A 404 is terminal: retrying cannot make the session appear.
      if (isNotFound(error)) return false
      return failureCount < 3
    },
  })
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines(),
    queryFn: ({ signal }) => fetchAllEngines(signal),
    staleTime: QUERY_STALE_TIMES_MS.engines,
  })
  const { nameFor } = useNameMap()
  const pending = usePendingAction(store, sessionId)

  const rawStatus = detailQuery.data?.status
  const now = useLiveDurationTick(rawStatus === "active" || rawStatus === "recording")

  useEffect(() => {
    return () => {
      if (escalationTimerRef.current !== null) window.clearTimeout(escalationTimerRef.current)
    }
  }, [])

  // Only the open session's remux frames are accepted (spec L193).
  useEffect(() => {
    if (!valid) return undefined
    activateRemuxProgress(sessionId)
    return () => deactivateRemuxProgress(sessionId)
  }, [valid, sessionId])

  // Remux progress only (spec L181); other session frames are the global event table's (todo 19).
  useEffect(() => {
    if (!valid) return undefined
    return subscribeSessionFrames((frame) => {
      if (frame.id !== sessionId) return
      if (!isRemuxProgressEvent(frame.event)) return
      applyRemuxProgressFrame(frame.data)
    })
  }, [valid, sessionId])

  // 204 means the request was accepted, not that the row is gone: once the
  // delete is pending, a 404 from the poll fallback confirms the removal.
  useEffect(() => {
    if (pending?.kind !== "delete") return
    if (!isNotFound(detailQuery.error)) return
    store.applyDeleted("session", sessionId)
    if (navigatedRef.current) return
    navigatedRef.current = true
    navigateToList("/sessions")
  }, [pending, detailQuery.error, store, sessionId, navigateToList])

  useEffect(() => {
    if (pending?.kind !== "stop") {
      if (escalationTimerRef.current !== null) {
        window.clearTimeout(escalationTimerRef.current)
        escalationTimerRef.current = null
      }
      setEscalated(false)
    }
  }, [pending])

  if (!valid) return <SessionNotFound />

  const session = detailQuery.data

  if (session === undefined) {
    if (detailQuery.isLoading) return <DetailSkeleton />
    if (isNotFound(detailQuery.error)) return <SessionNotFound />
    return (
      <main data-testid="session-detail-error" className="py-8">
        <ErrorPanel
          message={detailQuery.error === undefined ? UNEXPECTED_RESPONSE_MESSAGE : userMessageForError(detailQuery.error)}
          onRetry={() => {
            void detailQuery.refetch()
          }}
        />
      </main>
    )
  }

  const engine = enginesQuery.data?.find((item) => item.id === session.engine_id)
  const displayStatus = pendingString(pending?.fields, "status") ?? session.status
  const actions = sessionActionsFor(displayStatus, { canRecord: engineCanRecord(engine) })
  const stopAction = actions.find((action) => action.id === "stop")
  const deleteAction = actions.find((action) => action.id === "delete")
  const saveAction = actions.find((action) => action.id === "save-as-profile")
  const toggleAction = actions.find((action) => action.id === "toggle-recording")
  const stopPending = pending?.kind === "stop"
  const recordingPending = pending?.kind === "recording-toggle"
  const deletePending = pending?.kind === "delete"
  const recordingOn = pendingBoolean(pending?.fields, "recording") ?? session.recording === true
  const isAdmin = getAuthState().user?.role === "admin"
  const isRunning = session.status === "active" || session.status === "recording"
  const duration =
    session.started_at === null || session.started_at === undefined
      ? "—"
      : formatSessionDuration(session.started_at, session.ended_at ?? null, now)

  async function confirmStop() {
    setStopOpen(false)
    try {
      await stopEntity(store, {
        resource: "session",
        id: sessionId,
        mutate: () => stopSession(sessionId),
      })
      setControlUnavailable(false)
      if (escalationTimerRef.current !== null) window.clearTimeout(escalationTimerRef.current)
      escalationTimerRef.current = window.setTimeout(() => setEscalated(true), STOP_ESCALATION_MS)
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 502 || caught.status === 504)) {
        setControlUnavailable(true)
      } else {
        showToast(userMessageForError(caught))
      }
    }
  }

  async function handleToggleRecording() {
    const enabling = !recordingOn
    try {
      await toggleRecording(store, {
        resource: "session",
        id: sessionId,
        optimisticFields: { recording: enabling, status: enabling ? "recording" : "active" },
        mutate: () => (enabling ? enableSessionRecording(sessionId) : disableSessionRecording(sessionId)),
      })
      window.setTimeout(() => {
        if (store.getPending("session", sessionId)?.kind !== "recording-toggle") return
        void fetchSession(sessionId)
          .then((fresh) => store.applyAuthoritativeSnapshot("session", fresh.id, { ...fresh }))
          .catch(() => undefined)
      }, RECORDING_REFETCH_MS)
    } catch (caught) {
      showToast(userMessageForError(caught))
    }
  }

  async function confirmDelete() {
    setDeleteOpen(false)
    setControlUnavailable(false)
    try {
      await deleteEntity(store, {
        resource: "session",
        id: sessionId,
        mutate: () => deleteSession(sessionId),
      })
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) showToast("Cannot delete while remuxing")
      else showToast(userMessageForError(caught))
    }
  }

  return (
    <main data-testid="session-detail" className="relative flex flex-col gap-4">
      <header
        data-testid="session-detail-header"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-surface border border-border bg-bg-raised p-4"
      >
        <StatusChip status={displayStatus} live={isRunning} />
        <span data-testid="session-id" className="font-mono text-title text-text-primary">
          #{session.id}
        </span>
        <span data-testid="session-route" className="inline-flex items-center gap-1 text-body">
          <NameText name={nameFor("engine", session.engine_id) ?? session.engine_name ?? undefined} id={session.engine_id} />
          <span aria-hidden="true" className="text-text-muted">
            →
          </span>
          <NameText
            name={nameFor("resolver", session.resolver_id) ?? session.resolver_name ?? undefined}
            id={session.resolver_id}
          />
        </span>
        {isAdmin ? (
          <span data-testid="session-owner" className="text-small text-text-muted">
            owner <span className="text-text-secondary">{session.requester_user_token ?? "—"}</span>
          </span>
        ) : null}
        <span data-testid="session-duration" className="text-small text-text-muted">
          {duration}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {stopAction === undefined ? null : (
            <Button
              variant="primary"
              icon={Square}
              data-testid="session-stop"
              disabled={stopAction.disabled || stopPending}
              onClick={() => setStopOpen(true)}
            >
              {stopPending ? "Stopping…" : "Stop"}
            </Button>
          )}
          {saveAction === undefined ? null : (
            <Button
              variant="secondary"
              icon={Save}
              data-testid="session-save-profile"
              onClick={() => setSaveOpen(true)}
            >
              Save as profile
            </Button>
          )}
          {deleteAction === undefined ? null : (
            <Button
              variant="danger"
              icon={Trash2}
              data-testid="session-delete"
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </header>

      {controlUnavailable ? (
        <div
          data-testid="control-unavailable-banner"
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-control border border-danger/30 bg-danger/12 px-3 py-2 text-small text-danger-chip-text"
        >
          Could not stop the session — the engine did not respond.
          {deleteAction === undefined ? null : (
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              Force delete
            </Button>
          )}
        </div>
      ) : null}

      {escalated && stopPending ? (
        <div
          data-testid="still-stopping"
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-control border border-warn/30 bg-warn/12 px-3 py-2 text-small text-warn"
        >
          Still stopping…
          {deleteAction === undefined ? null : (
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              Force delete
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1100px]:grid-cols-2">
        <div data-testid="session-detail-left" className="flex flex-col gap-4">
          <LiveUrlsPanel urls={session.session_urls} />
          <AttemptsTimeline attempts={session.attempts} retryAttempts={session.retry_attempts} />
          <section data-testid="config-panel" className="rounded-surface border border-border bg-bg-raised p-4">
            <h2 className="text-label font-medium text-text-secondary">Configuration</h2>
            <div className="mt-3 flex flex-col gap-3">
              <ConfigBlock label="Resolver config" value={session.resolver_config} testId="config-resolver" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-small text-text-secondary">
                <span>
                  Retry mode:{" "}
                  <span data-testid="config-retry-mode" className="font-mono">
                    {session.retry_mode ?? "—"}
                  </span>
                </span>
                <span>
                  Retry attempts:{" "}
                  <span data-testid="config-retry-attempts" className="font-mono">
                    {session.retry_attempts ?? 0}
                  </span>
                </span>
              </div>
              <ConfigBlock label="Retry config" value={session.retry_config} testId="config-retry" />
            </div>
          </section>
        </div>

        <div data-testid="session-detail-right" className="flex flex-col gap-4">
          {displayStatus === "remuxing" ? <RemuxProgressCard sessionId={session.id} /> : null}
          <section data-testid="recording-card" className="rounded-surface border border-border bg-bg-raised p-4">
            <h2 className="text-label font-medium text-text-secondary">Recording</h2>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span data-testid="recording-state" className="text-body text-text-primary">
                {recordingOn ? "On" : "Off"}
              </span>
              {toggleAction === undefined ? (
                <span className="text-small text-text-muted">Unavailable</span>
              ) : (
                <Switch
                  checked={recordingOn}
                  label="Recording"
                  pending={recordingPending}
                  disabled={toggleAction.disabled}
                  disabledReason="Engine cannot record"
                  onCheckedChange={() => {
                    void handleToggleRecording()
                  }}
                />
              )}
            </div>
          </section>
        </div>
      </div>

      {deletePending ? (
        <div
          data-testid="session-deleting-overlay"
          role="status"
          aria-busy="true"
          className="absolute inset-0 z-10 flex items-center justify-center bg-bg-base/80"
        >
          <span className="inline-flex items-center gap-2 text-body text-text-secondary">
            <Loader2 aria-hidden="true" className="size-[var(--icon-default)] animate-spin" />
            Deleting…
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={stopOpen}
        title="Stop session"
        body={`Stop session #${sessionId}? The recording will finalize.`}
        confirmLabel="Stop"
        onConfirm={() => {
          void confirmStop()
        }}
        onCancel={() => setStopOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete session"
        body={`Delete session #${sessionId}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          void confirmDelete()
        }}
        onCancel={() => setDeleteOpen(false)}
      />
      <SaveAsProfileDialog open={saveOpen} sessionId={sessionId} onClose={() => setSaveOpen(false)} />
    </main>
  )
}
