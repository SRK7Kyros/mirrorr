import { useMemo, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { SkeletonList } from "@/components/ui/Skeleton"
import { StatusChip } from "@/components/ui/StatusChip"
import { ApiError } from "@/lib/api"
import { queryKeys, resolveEntityName, staleTimes } from "@/lib/query-keys"
import type { Autorun, Session } from "@/lib/schemas"
import { COUNTDOWN_TICK_MS, formatCountdown, formatDateTime } from "@/lib/time"
import { fetchAutorun, fetchSessionPage } from "@/views/shared/api"
import { useEntityList, useNameMaps, useNowTick } from "@/views/shared/hooks"
import {
  EngineResolverPair,
  JsonWell,
  RecordingCell,
  SaveAsProfileDialog,
  statusChipProps,
  useLooseNavigate,
  useQueryRemoved,
} from "@/views/shared/parts"
import { SessionStatusLine, PanelCard } from "@/views/sessions/session-detail-panels"
import { AutorunWizardDialog } from "./autorun-wizard-dialog"
import { useAutorunCommands } from "./autorun-shared"
import { isLive, isSpent } from "./filter-grammar"
import "@/styles/views-entities.css"

/**
 * §5.6 — Scheduled recording detail. Identity · schedule window + countdown ·
 * config snapshot · linked run · retirement note. "Run now" is client-composed
 * (`POST /sessions/` with this autorun's captured config) — there is no server
 * run endpoint. Config edits are locked while the run is live (no server lock
 * exists; the client owns this protection).
 */
export function AutorunDetail() {
  const params = useParams({ strict: false }) as { autorunId?: string }
  const autorunId = params.autorunId ?? ""
  const navigate = useLooseNavigate()
  const names = useNameMaps()
  const commands = useAutorunCommands()
  const now = useNowTick(COUNTDOWN_TICK_MS)

  const query = useQuery<Autorun>({
    queryKey: queryKeys.autorun(autorunId),
    queryFn: () => fetchAutorun(autorunId),
    staleTime: staleTimes.detail,
    retry: false,
  })

  useQueryRemoved(queryKeys.autorun(autorunId), () => {
    void navigate({ to: "/autoruns" })
  })

  // No session→autorun backlink endpoint — discover the spawned run from pages.
  const sessions = useEntityList<Session>({
    queryKey: queryKeys.sessions({ linked: autorunId }),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  })

  const autorun = query.data
  const linked = useMemo(() => {
    if (autorun === undefined) return null
    const matches = sessions.items.filter((session) => String(session.autorun_id) === String(autorun.id))
    matches.sort((a, b) => b.id - a.id)
    return matches[0] ?? null
  }, [autorun, sessions.items])

  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  if (query.isLoading) {
    return (
      <div className="ve">
        <SkeletonList rows={3} />
        <SkeletonList rows={4} />
      </div>
    )
  }

  if (query.isError || autorun === undefined) {
    const status = query.error instanceof ApiError ? query.error.status : 0
    const forbidden = status === 403
    return (
      <div className="ve">
        <ErrorPanel
          title={forbidden ? "Not your scheduled recording" : "Could not load scheduled recording"}
          body={
            forbidden
              ? "It belongs to another user."
              : query.error instanceof Error
                ? query.error.message
                : "Unexpected server response."
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Retry
              </Button>
              <Button variant="ghost" onClick={() => void navigate({ to: "/autoruns" })}>
                Back to scheduled recordings
              </Button>
            </>
          }
        />
      </div>
    )
  }

  const chip = statusChipProps(autorun.status)
  const spent = isSpent(autorun.status)
  const live = isLive(autorun.status)
  const engineName = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
  const resolverName = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)

  const menuItems = [
    { id: "edit", label: "Edit", onSelect: () => setWizardOpen(true) },
    { id: "export", label: "Export", onSelect: () => void commands.exportOne(autorun) },
    ...(spent ? [{ id: "save", label: "Save as profile", onSelect: () => setSaveOpen(true) }] : []),
    { id: "delete", label: "Delete", destructive: true, onSelect: () => setDeleteOpen(true) },
  ]

  return (
    <div className="ve">
      <header className="ve-detail-head">
        <StatusChip status={chip.status} title={spent ? "Spent" : chip.title} />
        <h1 className="ve-detail-head__title">{autorun.user_friendly_name}</h1>
        <span className="t-mono-inline">{autorun.snake_case_name}</span>
        <span className="t-mono num">{spent ? "retired" : formatCountdown(autorun.start_time, now)}</span>
        <div className="ve-detail-head__actions">
          <Button variant="primary" onClick={() => void commands.runNow(autorun)}>
            Run now
          </Button>
          <Button variant="secondary" onClick={() => setWizardOpen(true)}>
            Edit
          </Button>
          <OverflowMenu items={menuItems} triggerLabel="Scheduled recording actions" />
          <Button variant="ghost" onClick={() => void navigate({ to: "/autoruns" })}>
            Back
          </Button>
        </div>
      </header>

      {live ? (
        <p className="ve-hint">
          Its run is live — config changes affect a future run, not the current one. Moving the end
          time earlier may stop the running recording.
        </p>
      ) : null}

      <div className="ve-detail-grid">
        <div className="ve-stack">
          <PanelCard title="Schedule">
            <dl className="ve-kv">
              <dt className="ve-kv__label">Start</dt>
              <dd className="ve-kv__value">{formatDateTime(autorun.start_time)}</dd>
              <dt className="ve-kv__label">End</dt>
              <dd className="ve-kv__value">{formatDateTime(autorun.end_time)}</dd>
              <dt className="ve-kv__label">Countdown</dt>
              <dd className="ve-kv__value">{spent ? "retired" : formatCountdown(autorun.start_time, now)}</dd>
            </dl>
            <p className="ve-note">Times are stored as UTC — shown here in your local timezone.</p>
          </PanelCard>

          <PanelCard title="Config snapshot">
            <EngineResolverPair engineName={engineName} resolverName={resolverName} />
            <JsonWell label="Resolver config" value={autorun.resolver_config ?? {}} />
            <JsonWell
              label="Retry"
              value={{ mode: autorun.retry_mode ?? null, params: autorun.retry_config ?? {} }}
            />
          </PanelCard>

          <PanelCard title="Linked run">
            {linked === null ? (
              <p className="ve-note">
                {spent ? "No run recorded." : "No run yet — it fires once at its start time."}
              </p>
            ) : (
              <SessionStatusLine session={linked} />
            )}
          </PanelCard>

          <PanelCard title="Retirement">
            <p className="ve-note">
              Retired after its run — create a new scheduled recording to repeat.
            </p>
          </PanelCard>
        </div>

        <aside className="ve-stack">
          <PanelCard title="Recording">
            <RecordingCell recording={autorun.recording} canRecord />
            <p className="ve-note">When on, the spawned session records to disk.</p>
          </PanelCard>
        </aside>
      </div>

      <AutorunWizardDialog
        key={`autorun-wizard-${wizardOpen ? "open" : "closed"}-${autorun.id}`}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        editing={autorun}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false)
          void commands.remove(autorun)
        }}
        title={`Delete scheduled recording '${autorun.user_friendly_name}'?`}
        body={
          live ? (
            <>
              <p>It will also stop and delete any running recording it started.</p>
              <p>This cannot be undone.</p>
            </>
          ) : (
            <p>This cannot be undone.</p>
          )
        }
        tone="destructive"
        confirmLabel="Delete"
      />

      <SaveAsProfileDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={async (name) => {
          setSaveOpen(false)
          await commands.saveAsProfile(autorun, name)
        }}
      />
    </div>
  )
}
