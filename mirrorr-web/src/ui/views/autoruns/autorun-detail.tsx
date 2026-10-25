import { useEffect, useMemo, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ApiError, getErrorMessage, useEntityList, useNameMaps } from "@/api"
import { fetchAutorun, fetchSessionPage } from "@/api/endpoints"
import { queryKeys, resolveEntityName, staleTimes } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { isLive, isSpent } from "@/api/domain/filter-grammar"
import {
  COUNTDOWN_TICK_MS,
  formatCountdown,
  formatDateTime,
  formatDuration,
  parseNaiveUtc,
} from "@/api/time"
import type { Session } from "@/api/schemas"
import {
  Banner,
  buttonClass,
  EmptyState,
  ErrorPanel,
  IconAutoruns,
  IconClock,
  JsonView,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Stat,
  StatusChip,
  Tag,
} from "@/ui/components"
import { useLiveDurationSeconds, useNowTick } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { fallbackSourceLabel } from "@/api/domain/fallback-sources"
import { AutorunActionsMenu } from "./autorun-actions"

function KeyValue({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span className="mono text-truncate">{children}</span>
    </div>
  )
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

/**
 * §5.6 — Scheduled recording detail. Identity · schedule window + countdown ·
 * config snapshot · linked run · retirement note. Every row action comes from
 * `STATUS_MAP.autorunActions` (spec §1.4) via `AutorunActionsMenu`; there is no
 * server "run now" endpoint, so that action composes a `POST /sessions/` body
 * from this autorun's captured config. The linked run comes from the session
 * list narrowed by `?autorun=` — a server-side filter, not a history scan
 * (spec §5.6 has no dedicated backlink endpoint).
 */
export function AutorunDetailView({ autorunId }: { readonly autorunId: string }) {
  const names = useNameMaps()
  const now = useNowTick(COUNTDOWN_TICK_MS)

  const query = useQuery({
    queryKey: queryKeys.autorun(autorunId),
    queryFn: () => fetchAutorun(autorunId),
    staleTime: staleTimes.detail,
    refetchInterval: (q) => (q.state.data !== undefined && isLive(q.state.data.status) ? 5000 : false),
  })
  const autorun = query.data

  // The core narrows the session list to this autorun's runs (`?autorun=`),
  // so the first page already carries the spawned run.
  const sessions = useEntityList<Session>({
    queryKey: queryKeys.sessions({ autorun: autorunId }),
    fetchPage: (cursor) => fetchSessionPage(cursor, undefined, autorunId),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = sessions

  const linked = useMemo(() => {
    if (autorun === undefined) return null
    const matches = sessions.items.filter((session) => String(session.autorun_id) === String(autorun.id))
    matches.sort((a, b) => b.id - a.id)
    return matches[0] ?? null
  }, [autorun, sessions.items])

  const spent = autorun !== undefined && isSpent(autorun.status)
  const live = autorun !== undefined && isLive(autorun.status)
  const shouldFindRun = autorun !== undefined && (spent || live)

  // Only reached if an autorun ever spawns more runs than one page holds.
  useEffect(() => {
    if (!shouldFindRun || linked !== null || loadingAll || isFetching || !hasMore) return
    void loadAll().catch(() => undefined)
  }, [shouldFindRun, linked, loadingAll, isFetching, hasMore, loadAll])

  const linkedDuration = useLiveDurationSeconds(linked?.started_at, linked?.ended_at)

  if (query.isLoading) {
    return (
      <Page title={`Scheduled recording #${autorunId}`}>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={5} cols={3} />
          </PanelBody>
        </Panel>
      </Page>
    )
  }

  if (autorun === undefined) {
    return (
      <Page title={`Scheduled recording #${autorunId}`}>
        {isNotFound(query.error) ? (
          <EmptyState
            icon={<IconAutoruns size={22} />}
            title="Scheduled recording gone"
            text="It may have been deleted from another client."
            action={
              <Link className={buttonClass({ variant: "outline" })} to="/autoruns">
                Back to scheduled recordings
              </Link>
            }
          />
        ) : (
          <ErrorPanel
            message={
              isForbidden(query.error)
                ? "Not your scheduled recording — it belongs to another user."
                : getErrorMessage(query.error, "Could not load this scheduled recording")
            }
            onRetry={() => void query.refetch()}
          />
        )}
      </Page>
    )
  }

  const engine = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
  const resolver = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)
  const profile = resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)
  const fallbacks = [
    ...(autorun.fallback_profile_ids ?? []).map((id, index) =>
      resolveEntityName(autorun.fallback_profile_names?.[index], names.profiles, id),
    ),
    ...(autorun.fallback_sources ?? []).map((source) =>
      fallbackSourceLabel(source, (id) => resolveEntityName(undefined, names.resolvers, id)),
    ),
  ]
  const countdown = spent ? "retired" : formatCountdown(autorun.start_time, now)
  const startInPast =
    autorun.status === "scheduled" && parseNaiveUtc(autorun.start_time).getTime() < now.getTime()
  const hasResolverConfig =
    autorun.resolver_config !== undefined && Object.keys(autorun.resolver_config).length > 0
  const hasRetryConfig = autorun.retry_config !== undefined && Object.keys(autorun.retry_config).length > 0

  return (
    <Page
      title={autorun.user_friendly_name}
      description={`${engine} → ${resolver} · ${profile}`}
      actions={
        <>
          <Link className={buttonClass({ variant: "ghost" })} to="/autoruns">
            All scheduled recordings
          </Link>
          <AutorunActionsMenu autorun={autorun} />
        </>
      }
    >
      {live ? (
        <Banner
          kind="warning"
          title="Its run is live — config changes affect a future run, not the current one."
        />
      ) : null}
      {startInPast ? (
        <Banner kind="warning" title="Start time is in the past — the server will fire it immediately." />
      ) : null}

      <Panel>
        <PanelHead
          title="Status"
          actions={
            <>
              <StatusChip status={autorun.status} />
              <Tag title={autorun.snake_case_name}>{autorun.snake_case_name}</Tag>
            </>
          }
        />
        <PanelBody>
          <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
            <Stat
              label="Countdown"
              value={
                <span className="flex items-center gap-3" style={{ gap: "var(--s-1)" }}>
                  {!spent ? <IconClock size={14} /> : null}
                  {countdown}
                </span>
              }
            />
            <Stat label="Start" value={formatDateTime(autorun.start_time)} />
            <Stat label="End" value={formatDateTime(autorun.end_time)} />
            <Stat label="Recording" value={autorun.recording === true ? "On" : "Off"} />
            <Stat label="Profile" value={profile} />
            {__ADMIN__ ? (
              <Stat
                label="Owner"
                value={
                  autorun.requester_user_token !== undefined && autorun.requester_user_token !== ""
                    ? autorun.requester_user_token
                    : "—"
                }
              />
            ) : null}
          </div>
          <p className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
            Times are stored as UTC — shown here in your local timezone.
          </p>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHead title="Schedule" actions={getStatusDescriptor(autorun.status).label} />
            <PanelBody>
              <div className="flex flex-col gap-2">
                <KeyValue label="Start">{formatDateTime(autorun.start_time)}</KeyValue>
                <KeyValue label="End">{formatDateTime(autorun.end_time)}</KeyValue>
                <KeyValue label="Countdown">{countdown}</KeyValue>
                <KeyValue label="Slug">{autorun.snake_case_name}</KeyValue>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Config snapshot" />
            <PanelBody>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <KeyValue label="Engine">{engine}</KeyValue>
                  <KeyValue label="Resolver">{resolver}</KeyValue>
                  <KeyValue label="Profile">{profile}</KeyValue>
                  <KeyValue label="Fallbacks">
                    {fallbacks.length === 0 ? "—" : fallbacks.join(" → ")}
                  </KeyValue>
                  <KeyValue label="Retry mode">{autorun.retry_mode ?? "—"}</KeyValue>
                  <KeyValue label="Recording">{autorun.recording === true ? "On" : "Off"}</KeyValue>
                </div>
                {hasResolverConfig && autorun.resolver_config !== undefined ? (
                  <JsonView label="Resolver config" value={autorun.resolver_config} defaultOpen />
                ) : null}
                {hasRetryConfig && autorun.retry_config !== undefined ? (
                  <JsonView label="Retry config" value={autorun.retry_config} defaultOpen />
                ) : null}
              </div>
            </PanelBody>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHead title="Linked run" />
            <PanelBody>
              {linked === null ? (
                <p className="text-dim">
                  {spent
                    ? "No run recorded."
                    : "No run yet — it fires once at its start time."}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
                    <StatusChip status={linked.status} />
                    <Link
                      className="text-ink font-medium hover:text-brand"
                      to="/sessions/$sessionId"
                      params={{ sessionId: String(linked.id) }}
                    >
                      Session #{linked.id}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3" style={{ gap: "var(--s-3)" }}>
                    <span className="text-dim">
                      {linked.started_at != null && linked.started_at !== ""
                        ? `started ${formatDateTime(linked.started_at)}`
                        : "Not started"}
                    </span>
                    {linkedDuration !== null ? (
                      <span className="mono tnum">{formatDuration(linkedDuration)}</span>
                    ) : null}
                  </div>
                  <Link
                    className={buttonClass({ variant: "outline", size: "sm" })}
                    to="/sessions/$sessionId"
                    params={{ sessionId: String(linked.id) }}
                  >
                    Open session
                  </Link>
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Retirement" />
            <PanelBody>
              <p className="text-dim">
                Retired after its run — create a new scheduled recording to repeat.
              </p>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </Page>
  )
}
