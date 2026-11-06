import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { NameMaps } from "@/api"
import { ApiError, createSession, getErrorMessage, useEntityList, useNameMaps } from "@/api"
import { fetchAutorun, fetchSessionPage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName, staleTimes } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { autorunIssue, type AutorunIssue } from "@/api/domain/autorun-issue"
import { chainOf, mapNaming, rungLabel } from "@/api/domain/fallback-chain"
import { isLive, isSpent } from "@/api/domain/filter-grammar"
import { deriveRunState, type RunState } from "@/api/domain/run-state"
import { COUNTDOWN_TICK_MS, formatCountdown, parseNaiveUtc } from "@/api/time"
import type { Autorun, Session } from "@/api/schemas"
import {
  Button,
  EmptyState,
  ErrorPanel,
  IconAutoruns,
  IconEdit,
  IconPlay,
  Panel,
  PanelBody,
  SkeletonRows,
  StatusChip,
  Tag,
  buttonClass,
  toast,
  type QueryLike,
} from "@/ui/components"
import { useNowTick } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { AccessButton } from "@/ui/views/shared/resource-access-slot"
import { AutorunActionsMenu, sessionBodyFor } from "./autorun-actions"
import { AutorunConfigPanel } from "./autorun-detail-config"
import { LinkedRunPanel } from "./autorun-detail-linked-run"
import { AutorunNotices, autorunNotices } from "./autorun-detail-notices"
import { AutorunSchedulePanel, type ScheduleRetirement } from "./autorun-detail-schedule"
import { AutorunFormDialog } from "./autorun-form-dialog"

const TWO_COLUMNS = "grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

/**
 * The detail frame — `← Back to autoruns` above the page's single `h1`. The
 * back link sits outside `Page` on purpose: it is navigation, not a page
 * action, and the title block stays one heading with its verbs.
 */
function DetailFrame({
  title,
  description,
  actions,
  children,
}: {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <nav
        aria-label="Breadcrumb"
        className="mx-auto flex w-full max-w-[var(--content-max)] px-5 pt-6 max-sm:px-3 max-sm:pt-4"
      >
        <Link
          to="/autoruns"
          className="tab-stop inline-flex min-h-6 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          <span aria-hidden="true">←</span>
          Back to autoruns
        </Link>
      </nav>
      <Page title={title} description={description} actions={actions}>
        {children}
      </Page>
    </div>
  )
}

/**
 * Identity only — the numeric id and the slug. Profile, engine and resolver are
 * configuration and appear once, in the Config panel (AUT-08: every value has
 * exactly one home, so a name printed here could never be printed again).
 */
function DetailSubtitle({ autorun }: { readonly autorun: Autorun }) {
  return (
    <>
      <span className="mono">#{autorun.id}</span>
      <span aria-hidden="true"> · </span>
      <span className="mono">{autorun.snake_case_name}</span>
    </>
  )
}

/**
 * Header verbs come from `STATUS_MAP.autorunActions` — the same authority the
 * card and the `⋯` menu read. A completed one-shot has no edit and no run-now,
 * so the header shows neither rather than a button that would be refused.
 * `Edit schedule` is the primary and is never labelled with a state.
 */
function DetailActions({
  autorun,
  issue,
  runNowPending,
  onEdit,
  onRunNow,
}: {
  readonly autorun: Autorun
  readonly issue: AutorunIssue | null
  readonly runNowPending: boolean
  readonly onEdit: () => void
  readonly onRunNow: () => void
}) {
  const allowed = getStatusDescriptor(autorun.status).autorunActions
  return (
    <>
      <StatusChip status={autorun.status} />
      {issue === null ? null : <Tag title={issue.detail}>{issue.label}</Tag>}
      {allowed.includes("edit") ? (
        <Button
          variant="primary"
          size="lg"
          className="min-h-11 min-w-11"
          icon={<IconEdit size={15} />}
          onClick={onEdit}
        >
          Edit schedule
        </Button>
      ) : null}
      {allowed.includes("run-now") ? (
        <Button
          variant="secondary"
          size="lg"
          className="min-h-11 min-w-11"
          icon={<IconPlay size={15} />}
          loading={runNowPending}
          onClick={onRunNow}
          title="Starts a run now — this autorun still fires at its start time."
        >
          Run now
        </Button>
      ) : null}
      <AccessButton resourceType="autorun" id={autorun.id} label={autorun.user_friendly_name} />
      <AutorunActionsMenu autorun={autorun} />
    </>
  )
}

function retirementKind(state: RunState): ScheduleRetirement {
  switch (state) {
    case "scheduled":
    case "starting":
      return "upcoming"
    case "live":
    case "recording":
      return "live"
    case "completed":
    case "failed":
      return "retired"
    default:
      return "unknown"
  }
}

export interface AutorunDetailBodyProps {
  readonly autorun: Autorun
  readonly names: NameMaps
  /** Injected so the countdown and the notices are testable without a clock. */
  readonly now: Date
  readonly linked: Session | null
  readonly sessions: QueryLike
  readonly runNowPending: boolean
  readonly onEdit: () => void
  readonly onRunNow: () => void
}

/** Everything the page prints, assembled from props — no queries in here. */
export function AutorunDetailBody({
  autorun,
  names,
  now,
  linked,
  sessions,
  runNowPending,
  onEdit,
  onRunNow,
}: AutorunDetailBodyProps) {
  const engine = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
  const resolver = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)
  const profile = resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)
  const fallbacks = chainOf(autorun).map((rung) =>
    rungLabel(
      rung,
      mapNaming({ engines: names.engines, resolvers: names.resolvers, profiles: names.profiles }),
    ),
  )
  const issue = autorunIssue(autorun)
  const run = deriveRunState({
    status: autorun.status,
    ...(autorun.recording === undefined ? {} : { recording: autorun.recording }),
    ...(autorun.issue === undefined ? {} : { issue: autorun.issue }),
  })
  const startPassed =
    autorun.status === "scheduled" && parseNaiveUtc(autorun.start_time).getTime() < now.getTime()
  const countdown =
    run.state === "scheduled" && !startPassed ? formatCountdown(autorun.start_time, now) : null
  const notices = autorunNotices({ issue, startPassed, live: run.panels.live })
  const spent = run.state === "completed" || run.state === "failed"

  return (
    <DetailFrame
      title={autorun.user_friendly_name}
      description={<DetailSubtitle autorun={autorun} />}
      actions={
        <DetailActions
          autorun={autorun}
          issue={issue}
          runNowPending={runNowPending}
          onEdit={onEdit}
          onRunNow={onRunNow}
        />
      }
    >
      <AutorunNotices items={notices} />
      <div className={TWO_COLUMNS} data-slot="autorun-columns">
        <div className="flex min-w-0 flex-col gap-4" data-slot="autorun-main">
          <AutorunSchedulePanel
            startTime={autorun.start_time}
            endTime={autorun.end_time}
            countdown={countdown}
            retirement={retirementKind(run.state)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4" data-slot="autorun-side">
          <AutorunConfigPanel
            autorun={autorun}
            engine={engine}
            resolver={resolver}
            profile={profile}
            fallbacks={fallbacks}
          />
          <LinkedRunPanel query={sessions} session={linked} spent={spent} />
        </div>
      </div>
    </DetailFrame>
  )
}

function DetailSkeleton() {
  return (
    <div className={TWO_COLUMNS}>
      <Panel>
        <PanelBody>
          <SkeletonRows rows={4} cols={2} />
        </PanelBody>
      </Panel>
      <div className="flex flex-col gap-4">
        <Panel>
          <PanelBody>
            <SkeletonRows rows={3} cols={2} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={2} cols={2} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}

/**
 * Data layer for the detail page: one record query, the run it spawned
 * (`?autorun=`), and the two verbs the header offers. Everything it computes is
 * handed to `AutorunDetailBody`, which renders and decides nothing.
 */
function AutorunDetailContent({ autorun }: { readonly autorun: Autorun }) {
  const names = useNameMaps()
  const now = useNowTick(COUNTDOWN_TICK_MS)
  const [editOpen, setEditOpen] = useState(false)
  const queryClient = useQueryClient()

  const sessions = useEntityList<Session>({
    queryKey: queryKeys.sessions({ autorun: autorun.id }),
    fetchPage: (cursor) => fetchSessionPage(cursor, undefined, { autorun: autorun.id }),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = sessions

  const linked = useMemo(() => {
    const matches = sessions.items.filter(
      (session) => String(session.autorun_id) === String(autorun.id),
    )
    matches.sort((a, b) => b.id - a.id)
    return matches[0] ?? null
  }, [autorun.id, sessions.items])

  const runNow = useMutation({
    mutationFn: () => createSession(sessionBodyFor(autorun)),
    onSuccess: (session) => {
      toast.success(
        `Session #${session.id} started`,
        "This autorun still fires at its start time.",
      )
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions({ autorun: autorun.id }) })
    },
    onError: (error) =>
      toast.error("Could not start a run now", getErrorMessage(error, "Request failed")),
  })

  // Only reached if an autorun ever spawns more runs than one page holds.
  const shouldFindRun = isSpent(autorun.status) || isLive(autorun.status)
  useEffect(() => {
    if (!shouldFindRun || linked !== null || loadingAll || isFetching || !hasMore) return
    void loadAll().catch(() => undefined)
  }, [shouldFindRun, linked, loadingAll, isFetching, hasMore, loadAll])

  return (
    <>
      <AutorunDetailBody
        autorun={autorun}
        names={names}
        now={now}
        linked={linked}
        sessions={sessions}
        runNowPending={runNow.isPending}
        onEdit={() => setEditOpen(true)}
        onRunNow={() => runNow.mutate()}
      />
      <AutorunFormDialog open={editOpen} autorun={autorun} onClose={() => setEditOpen(false)} />
    </>
  )
}

/**
 * Autorun detail (SCR-06). One `Schedule` panel replaces the old
 * Status/Schedule/Config triple print — the header chip is the only status, the
 * window and countdown live in one definition list, and the copied config sits
 * in a collapsed disclosure. The linked run has four exclusive states, and the
 * three warnings are one ordered list above the two columns.
 */
export function AutorunDetailView({ autorunId }: { readonly autorunId: string }) {
  const query = useQuery({
    queryKey: queryKeys.autorun(autorunId),
    queryFn: () => fetchAutorun(autorunId),
    staleTime: staleTimes.detail,
    refetchInterval: (q) =>
      q.state.data !== undefined && isLive(q.state.data.status) ? 5000 : false,
  })
  const autorun = query.data

  if (query.isLoading) {
    return (
      <DetailFrame title={`Autorun #${autorunId}`}>
        <DetailSkeleton />
      </DetailFrame>
    )
  }

  if (autorun === undefined) {
    return (
      <DetailFrame title={`Autorun #${autorunId}`}>
        {isNotFound(query.error) ? (
          <EmptyState
            icon={<IconAutoruns size={22} />}
            title="Autorun gone"
            text="It may have been deleted from another client."
            action={
              <Link className={buttonClass({ variant: "outline" })} to="/autoruns">
                Back to autoruns
              </Link>
            }
          />
        ) : (
          <ErrorPanel
            message={
              isForbidden(query.error)
                ? "Not your autorun — it belongs to another user."
                : getErrorMessage(query.error, "Could not load this autorun")
            }
            onRetry={() => void query.refetch()}
          />
        )}
      </DetailFrame>
    )
  }

  return <AutorunDetailContent autorun={autorun} />
}
