import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getErrorMessage, useNameMaps } from "@/api";
import { fetchSession } from "@/api/endpoints";
import { queryKeys, resolveEntityName, staleTimes } from "@/api/query-keys";
import { getStatusDescriptor } from "@/api/status";
import { isLive } from "@/api/domain/filter-grammar";
import { formatDateTime, formatDuration } from "@/api/time";
import {
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
import { RemuxProgressBar } from "./remux-progress";
import { SessionSaveProfileButton } from "./session-save-profile-button";
import { SessionStopDeleteButton } from "./session-stop-delete-button";
import { SessionRecordingButton } from "./session-recording-button";
import { SessionPreviewPlayer } from "./session-preview-player";
import { sessionTitle } from "./session-title";
import { SessionUrls, pickPlayableUrl, toSessionUrls } from "./session-urls";

export interface AttemptView {
  readonly index: number;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly reason: string | null;
}

/** Attempts arrive as loose records — read defensively, never assume a shape. */
export function toAttemptView(
  raw: Record<string, unknown>,
  fallbackIndex: number,
): AttemptView {
  const str = (key: string): string | null => {
    const value = raw[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const num = (key: string): number | null => {
    const value = raw[key];
    return typeof value === "number" ? value : null;
  };
  const endedAt = str("ended_at");
  const reason = str("reason") ?? str("error");
  return {
    index: num("index") ?? num("attempt") ?? fallbackIndex + 1,
    // The record has no status field. No `ended_at` means it is still running;
    // any reason but a user stop is a failure. A stop maps to `completed`,
    // matching the status a stopped session itself ends on.
    status:
      endedAt === null
        ? "active"
        : reason !== null && reason !== "stopped"
          ? "failed"
          : "completed",
    startedAt: str("started_at"),
    endedAt,
    exitCode: num("returncode") ?? num("exit_code"),
    reason,
  };
}

function KeyValue({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="row-between">
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
              <Link className="btn btn-outline" to="/sessions">
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
  const attempts = (session.attempts ?? [])
    .map((raw, index) => toAttemptView(raw, index))
    .sort((a, b) => b.index - a.index);
  const remuxing =
    session.status === "remuxing" || session.status === "finalizing";
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
          <Link className="btn btn-ghost" to="/sessions">
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
          <div className="grid-3">
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
              className="stack stack-sm"
            />
          ) : null}
        </PanelBody>
      </Panel>

      <div className="grid-2">
        <Panel>
          <PanelHead
            title="Attempts"
            actions={getStatusDescriptor(session.status).label}
          />
          <PanelBody>
            {attempts.length === 0 ? (
              <p className="text-dim">
                Waiting for the supervisor — attempt 1 not started yet.
              </p>
            ) : (
              <div
                className="stack"
                style={{ maxHeight: 480, overflowY: "auto" }}
                role="list"
                aria-label="Attempt timeline"
              >
                {attempts.map((attempt) => (
                  <div
                    key={attempt.index}
                    className="stack stack-sm"
                    role="listitem"
                  >
                    <div className="row-between">
                      <span className="row" style={{ gap: "var(--s-2)" }}>
                        <span className="mono tnum">#{attempt.index}</span>
                        <StatusChip status={attempt.status} />
                      </span>
                      <span className="text-dim">
                        {attempt.startedAt !== null
                          ? formatDateTime(attempt.startedAt)
                          : "—"}
                        {" → "}
                        {attempt.endedAt !== null
                          ? formatDateTime(attempt.endedAt)
                          : "running"}
                      </span>
                    </div>
                    {attempt.exitCode !== null || attempt.reason !== null ? (
                      <div className="row" style={{ gap: "var(--s-3)" }}>
                        {attempt.exitCode !== null ? (
                          <span className="mono tnum text-dim">
                            exit {attempt.exitCode}
                          </span>
                        ) : null}
                        {attempt.reason !== null ? (
                          <span className="text-dim">{attempt.reason}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </PanelBody>
        </Panel>

        <div className="stack">
          <Panel>
            <PanelHead title="Live sources" />
            <PanelBody>
              {urls.length === 0 ? (
                <p className="text-dim">
                  Live URLs not configured (operator must set{" "}
                  <span className="mono">web_url</span>).
                </p>
              ) : (
                <div className="stack">
                  {playable !== null ? (
                    <SessionPreviewPlayer
                      src={playable}
                      loop={!isLive(session.status)}
                      autoPlay
                      label={`session #${session.id}`}
                    />
                  ) : null}
                  <SessionUrls urls={urls} />
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead title="Config snapshot" />
            <PanelBody>
              <div className="stack">
                <div className="stack stack-sm">
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
        </div>
      </div>
    </Page>
  );
}
