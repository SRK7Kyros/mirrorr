import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getErrorMessage, useNameMaps } from "@/api";
import { fetchSession } from "@/api/endpoints";
import { queryKeys, resolveEntityName, staleTimes } from "@/api/query-keys";
import { getStatusDescriptor, isStarting } from "@/api/status";
import { isLive } from "@/api/domain/filter-grammar";
import { planLabel, mapNaming } from "@/api/domain/fallback-chain";
import { formatDateTime, formatDuration } from "@/api/time";
import {
  buttonClass,
  EmptyState,
  ErrorPanel,
  IconSessions,
  JsonView,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Stat,
  StatusChip,
  Tag,
} from "@/ui/components";
import { useLiveDurationSeconds } from "@/ui/hooks";
import { Page } from "@/ui/views/shared/page";
import { SessionTimeline, toAttemptView, toCaptureView } from "./session-timeline";
import { RemuxProgressBar } from "./remux-progress";
import { SessionSaveProfileButton } from "./session-save-profile-button";
import { SessionStopDeleteButton } from "./session-stop-delete-button";
import { SessionRecordingButton } from "./session-recording-button";
import { SessionPlayerFrame } from "./session-preview-player";
import { SessionPlayer } from "./session-player";
import { SessionStarting } from "./session-starting";
import { SessionTelemetryReadout } from "./session-telemetry";
import { sessionTitle } from "./session-title";
import { SessionUrls, pickHtmlPlayerUrl, pickPlayableUrl, toSessionUrls } from "./session-urls";

function KeyValue({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span className="mono text-truncate">{children}</span>
    </div>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function SessionDetailView({
  sessionId,
}: {
  readonly sessionId: string;
}) {
  const names = useNameMaps();
  const query = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
    staleTime: staleTimes.detail,
    refetchInterval: (q) =>
      q.state.data !== undefined && isLive(q.state.data.status) ? 5000 : false,
  });
  const session = query.data;
  const duration = useLiveDurationSeconds(
    session?.started_at,
    session?.ended_at,
  );

  if (query.isLoading) {
    return (
      <Page title={`Session #${sessionId}`}>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={5} cols={3} />
          </PanelBody>
        </Panel>
      </Page>
    );
  }

  if (session === undefined) {
    return (
      <Page title={`Session #${sessionId}`}>
        {isNotFound(query.error) ? (
          <EmptyState
            icon={<IconSessions size={22} />}
            title="Session gone"
            text="It may have been deleted from another client."
            action={
              <Link className={buttonClass({ variant: "outline" })} to="/sessions">
                Back to sessions
              </Link>
            }
          />
        ) : (
          <ErrorPanel
            message={getErrorMessage(
              query.error,
              "Could not load this session",
            )}
            onRetry={() => void query.refetch()}
          />
        )}
      </Page>
    );
  }

  const engine = resolveEntityName(
    session.engine_name,
    names.engines,
    session.engine_id,
  );
  const resolver = resolveEntityName(
    session.resolver_name,
    names.resolvers,
    session.resolver_id,
  );
  const profile = resolveEntityName(
    session.profile_name,
    names.profiles,
    session.profile_id,
  );
  const urls = toSessionUrls(session.session_urls);
  const playable = pickPlayableUrl(urls);
  const playerUrl = pickHtmlPlayerUrl(urls);
  const attempts = (session.attempts ?? [])
    .map((raw, index) => toAttemptView(raw, index))
    .sort((a, b) => b.index - a.index);
  const captures = (session.captures ?? [])
    .map((raw, index) => toCaptureView(raw, index))
    .sort((a, b) => a.index - b.index);
  // The plan's own first entry is the source running now, not a fallback —
  // only what follows it is still owed.
  const plan = session.capture_plan ?? [];
  const planBase = {
    engine_id: session.engine_id,
    resolver_id: session.resolver_id,
    resolver_config: session.resolver_config ?? {},
    profile_id: session.profile_id ?? null,
    profile_name: session.profile_name ?? "",
  };
  const planNaming = mapNaming({
    engines: names.engines ?? new Map<number, string>(),
    resolvers: names.resolvers ?? new Map<number, string>(),
    profiles: names.profiles ?? new Map<number, string>(),
  });
  const pending = isLive(session.status)
    ? plan
        .slice(Math.max(captures.length, 1))
        .map((entry) => planLabel(entry, planBase, planNaming))
    : [];
  const remuxing =
    session.status === "remuxing" || session.status === "finalizing";
  // Telemetry covers the attempt's own processes — remux/finalize sample nothing.
  const attemptRunning = isLive(session.status) && !remuxing;
  const starting = isStarting(session.status);
  const retryCount = session.retry_attempts ?? 0;
  const hasResolverConfig =
    session.resolver_config !== undefined &&
    Object.keys(session.resolver_config).length > 0;
  const hasRetryConfig =
    session.retry_config !== undefined &&
    Object.keys(session.retry_config).length > 0;

  return (
    <Page
      title={sessionTitle(session, names)}
      description={`#${session.id} · ${engine} → ${resolver} · ${profile}`}
      actions={
        <>
          <Link className={buttonClass({ variant: "ghost" })} to="/sessions">
            All sessions
          </Link>
          <SessionSaveProfileButton session={session} size="md" />
          <SessionRecordingButton session={session} size="md" />
          <SessionStopDeleteButton session={session} size="md" />
        </>
      }
    >
      <Panel>
        <PanelHead
          title="Status"
          actions={
            <>
              <StatusChip status={session.status} />
              {retryCount > 0 ? <Tag accent>Retry {retryCount}</Tag> : null}
            </>
          }
        />
        <PanelBody>
          <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
            <Stat
              label="Duration"
              value={duration === null ? "—" : formatDuration(duration)}
            />
            <Stat
              label="Started"
              value={
                session.started_at != null
                  ? formatDateTime(session.started_at)
                  : "Not started"
              }
            />
            <Stat
              label="Ended"
              value={
                session.ended_at != null
                  ? formatDateTime(session.ended_at)
                  : "—"
              }
            />
            <Stat
              label="Recording"
              value={session.recording === true ? "On" : "Off"}
            />
            <Stat label="Retry attempts" value={retryCount} />
            {__ADMIN__ ? (
              <Stat
                label="Owner"
                value={
                  session.requester_user_token !== undefined &&
                  session.requester_user_token !== ""
                    ? session.requester_user_token
                    : "—"
                }
              />
            ) : null}
          </div>
          {remuxing ? (
            <RemuxProgressBar
              sessionId={session.id}
              className="flex flex-col gap-2"
            />
          ) : null}
          {attemptRunning ? (
            <SessionTelemetryReadout sessionId={session.id} className="mt-4" />
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead title="Live sources" />
        <PanelBody>
          {starting || urls.length > 0 ? (
            <div className="flex flex-col gap-4">
              {starting ? (
                <SessionStarting
                  label={getStatusDescriptor(session.status).label}
                  className="aspect-video w-full rounded-md"
                />
              ) : playable !== null ? (
                <SessionPlayer src={playable} label={sessionTitle(session, names)} />
              ) : playerUrl !== null ? (
                <SessionPlayerFrame url={playerUrl} label={sessionTitle(session, names)} />
              ) : null}
              {urls.length > 0 ? <SessionUrls urls={urls} /> : null}
            </div>
          ) : (
            <p className="text-dim">
              Live URLs not configured (operator must set{" "}
              <span className="mono">web_url</span>).
            </p>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        {/* The status chip above already names the state; what only this panel
            knows is how many sources the run has to fall back to. */}
        <PanelHead
          title="Timeline"
          actions={plan.length > 1 ? <Tag>{plan.length} in the plan</Tag> : null}
        />
        <PanelBody>
          <SessionTimeline
            captures={captures}
            attempts={attempts}
            pending={pending}
          />
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
              <KeyValue label="Retry mode">
                {session.retry_mode ?? "—"}
              </KeyValue>
            </div>
            {hasResolverConfig && session.resolver_config !== undefined ? (
              <JsonView
                label="Resolver config"
                value={session.resolver_config}
                defaultOpen
              />
            ) : null}
            {hasRetryConfig && session.retry_config !== undefined ? (
              <JsonView
                label="Retry config"
                value={session.retry_config}
                defaultOpen
              />
            ) : null}
          </div>
        </PanelBody>
      </Panel>
    </Page>
  );
}
