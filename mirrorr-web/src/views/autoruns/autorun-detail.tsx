import { useMemo, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { SkeletonList } from "@/components/ui/Skeleton"
import { StatusChip } from "@/components/ui/StatusChip"
import { queryKeys, resolveEntityName, staleTimes } from "@/lib/query-keys"
import type { Autorun, Session } from "@/lib/schemas"
import { COUNTDOWN_TICK_MS, formatCountdown, formatDateTime } from "@/lib/time"
import { fetchAutorun } from "@/views/shared/api"
import {
  useEntityList,
  useNameMaps,
  useNowTick,
} from "@/views/shared/hooks"
import { fetchSessionPage } from "@/views/shared/api"
import {
  JsonWell,
  RecordingCell,
  SaveAsProfileDialog,
  statusChipProps,
  useLooseNavigate,
  useQueryRemoved,
} from "@/views/shared/parts"
import { SessionStatusLine } from "@/views/sessions/session-detail-panels"
import { AutorunWizardDialog } from "./autorun-wizard-dialog"
import { useAutorunCommands } from "./autorun-shared"
import { isLive, isSpent } from "./filter-grammar"

/** V6 — Autorun detail (`/autoruns/$autorunId`). */
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

  // No backlink endpoint — linked session discovery scans cached pages (contract).
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
      <div className="view">
        <SkeletonList rows={5} />
      </div>
    )
  }

  if (query.isError || autorun === undefined) {
    return (
      <div className="view">
        <ErrorPanel
          title="Autorun not found"
          body={query.error instanceof Error ? query.error.message : "The autorun is gone or never existed."}
          actions={
            <Button variant="ghost" onClick={() => void navigate({ to: "/autoruns" })}>
              Back to autoruns
            </Button>
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
    { id: "run", label: "Run now", onSelect: () => void commands.runNow(autorun) },
    ...(spent ? [{ id: "save", label: "Save as profile", onSelect: () => setSaveOpen(true) }] : []),
    { id: "export", label: "Export", onSelect: () => void commands.exportOne(autorun) },
    { id: "delete", label: "Delete", destructive: true, onSelect: () => setDeleteOpen(true) },
  ]

  return (
    <div className="view">
      <header className="detail-header">
        <StatusChip status={chip.status} title={spent ? "spent" : chip.title} />
        <h1 className="card__title">{autorun.user_friendly_name}</h1>
        <span className="t-mono-inline">{autorun.snake_case_name}</span>
        <span className="detail-duration num">
          {spent ? "spent" : formatCountdown(autorun.start_time, now)}
        </span>
        <div className="detail-header__actions">
          <Button variant="ghost" className="row-primary-action" onClick={() => setWizardOpen(true)}>
            Edit
          </Button>
          <OverflowMenu items={menuItems} triggerLabel="Autorun actions" />
          <Button variant="ghost" onClick={() => void navigate({ to: "/autoruns" })}>
            Back
          </Button>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-grid__main card-stack">
          <section className="card card-stack">
            <h2 className="card__title">Schedule</h2>
            <dl className="kv">
              <dt className="kv__label">Start</dt>
              <dd className="kv__value t-mono">{formatDateTime(autorun.start_time)}</dd>
              <dt className="kv__label">End</dt>
              <dd className="kv__value t-mono">{formatDateTime(autorun.end_time)}</dd>
              <dt className="kv__label">Next run</dt>
              <dd className="kv__value t-mono">
                {autorun.next_run_at == null ? "—" : formatDateTime(autorun.next_run_at)}
              </dd>
              <dt className="kv__label">Last run</dt>
              <dd className="kv__value t-mono">
                {autorun.last_run_at == null ? "—" : formatDateTime(autorun.last_run_at)}
              </dd>
            </dl>
          </section>

          <section className="card card-stack">
            <h2 className="card__title">Linked live session</h2>
            {linked === null ? (
              <p className="t-body view-subtitle">No live session yet</p>
            ) : (
              <SessionStatusLine session={linked} />
            )}
          </section>

          <section className="card card-stack">
            <h2 className="card__title">Config</h2>
            <span className="engine-pair__strong">
              {engineName}
              {" → "}
              {resolverName}
            </span>
            <details>
              <summary className="schema-group__toggle">Resolver config</summary>
              <JsonWell value={autorun.resolver_config ?? {}} />
            </details>
            <details>
              <summary className="schema-group__toggle">Retry config</summary>
              <JsonWell
                value={{
                  mode: autorun.retry_mode ?? null,
                  params: autorun.retry_config ?? {},
                }}
              />
            </details>
          </section>
        </div>

        <aside className="detail-grid__aside card-stack">
          <section className="card card-stack">
            <h2 className="card__title">Recording</h2>
            <RecordingCell
              recording={autorun.recording}
              canRecord={true}
            />
          </section>
          {live ? (
            <p className="warn-text">
              This autorun is running — only name and times can change.
            </p>
          ) : null}
        </aside>
      </div>

      <AutorunWizardDialog
        key={`${wizardOpen ? "open" : "closed"}-${autorun.id}`}
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
        title={`Delete autorun '${autorun.user_friendly_name}'?`}
        body={
          live ? (
            <>
              <p>A recording is running — deleting will stop and delete it.</p>
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
