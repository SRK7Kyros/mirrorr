import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ApiError, useNameMaps } from "@/api"
import { fetchSession } from "@/api/endpoints"
import { deriveRunState } from "@/api/domain/run-state"
import { isLive } from "@/api/domain/filter-grammar"
import { queryKeys, staleTimes } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import {
  buttonClass,
  EmptyState,
  IconExternal,
  IconSessions,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  SkeletonRows,
  StatusChip,
  Tag,
} from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { BackToSessionsLink, SessionOverflow, StopRecordingAction } from "./session-detail-actions"
import {
  SessionAccessPanel,
  SessionConfigPanel,
  SessionRunPanel,
} from "./session-detail-facts"
import {
  failureReason,
  fileEvidence,
  headerSubtitle,
  parseSessionId,
  pendingFallbacks,
  servedFileUrl,
  sourcePanelMode,
  timelineEmptyText,
} from "./session-detail-model"
import { SessionSourcePanel, sourceFillsBox } from "./session-detail-source"
import { capturedBytes } from "./session-media"
import { SessionTimeline, toAttemptView, toCaptureView } from "./session-timeline"
import { sessionTitle } from "./session-title"
import { toSessionUrls } from "./session-urls"

/**
 * SCR-04 — one run, read through one derived state.
 *
 * The page used to answer "is it running?", "is there a file?" and "is the
 * supervisor listening?" in four different panels, which is how a completed run
 * ended up with a live-sources panel and a supervisor sentence under a
 * `Completed` chip (SDR-01). `deriveRunState()` answers once; every branch below
 * reads its answer and none of them re-derives it.
 *
 * Layout is two columns from 1024 px (`minmax(0,2fr) / minmax(300px,1fr)`): the
 * player owns the wide column and the whole rail — Run, Timeline, Config, Access
 * — sits beside it, which is what keeps the two heights close instead of leaving
 * a column of empty page under three short panels. The rail is one element, so a
 * run with no player to show (failed, or finished with no file) stacks the same
 * panels down a single column rather than opening a hole where the video would
 * have been.
 */

const COLUMNS =
  "grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] lg:items-start"
const RAIL = "flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-1"
const HISTORY = "flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1"
const STACKED = "flex min-w-0 flex-col gap-5"

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

function InvalidSessionId({ raw }: { readonly raw: string }) {
  return (
    <Page title="That is not a session id">
      <EmptyState
        icon={<IconSessions size={22} />}
        title="The link points at something that is not a run"
        text={
          <>
            A session id is a number, like <span className="mono">#104</span>. Nothing was deleted
            — there is no session at <span className="mono">/sessions/{raw}</span> to open.
          </>
        }
        action={
          <Link
            className={buttonClass({ variant: "outline", size: "lg", className: "min-h-11 min-w-11" })}
            to="/sessions"
          >
            Back to sessions
          </Link>
        }
      />
    </Page>
  )
}

function DetailSkeleton() {
  return (
    <div className={COLUMNS}>
      <div className={HISTORY}>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={6} cols={1} />
          </PanelBody>
        </Panel>
      </div>
      <div className={RAIL}>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={5} cols={2} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <SkeletonRows rows={3} cols={1} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}

export function SessionDetailView({ sessionId }: { readonly sessionId: string }) {
  const id = parseSessionId(sessionId)
  if (id === null) return <InvalidSessionId raw={sessionId} />
  return <SessionDetail id={id} />
}

function SessionDetail({ id }: { readonly id: number }) {
  const names = useNameMaps()
  const query = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => fetchSession(String(id)),
    staleTime: staleTimes.detail,
    refetchInterval: (q) =>
      q.state.data !== undefined && isLive(q.state.data.status) ? 5000 : false,
  })
  const session = query.data
  const duration = useLiveDurationSeconds(session?.started_at, session?.ended_at)
  const [configOpen, setConfigOpen] = useState(false)

  const run =
    session === undefined
      ? null
      : deriveRunState({
          status: session.status,
          recording: session.recording,
          hasRecording: fileEvidence(session, toSessionUrls(session.session_urls)).kept,
        })
  const failed = run?.state === "failed"

  useEffect(() => {
    if (failed) setConfigOpen(true)
  }, [failed])

  const title = session === undefined ? `Session #${id}` : sessionTitle(session, names)

  if (isNotFound(query.error)) {
    return (
      <Page title={`No session #${id}`}>
        <EmptyState
          icon={<IconSessions size={22} />}
          title={`Session #${id} is not here`}
          text="It may have been deleted from another client, or it belongs to another account. A link to an id that is not a number gets its own page."
          action={
            <Link
            className={buttonClass({ variant: "outline", size: "lg", className: "min-h-11 min-w-11" })}
            to="/sessions"
          >
              Back to sessions
            </Link>
          }
        />
      </Page>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <nav
        aria-label="Breadcrumb"
        className="mx-auto flex w-full max-w-[var(--content-max)] px-5 pt-6 max-sm:px-3 max-sm:pt-4"
      >
        <BackToSessionsLink />
      </nav>
      <Page
        title={title}
        description={session === undefined ? undefined : headerSubtitle(session, names)}
        actions={
          session === undefined || run === null ? undefined : (
            <SessionHeaderActions session={session} run={run} title={title} />
          )
        }
      >
        <QueryState
          query={query}
          loading={<DetailSkeleton />}
          errorMessage="Could not load this session"
        >
          {session === undefined || run === null ? null : (
            <SessionDetailBody
              session={session}
              run={run}
              title={title}
              durationSeconds={duration}
              configOpen={configOpen}
              onConfigToggle={setConfigOpen}
            />
          )}
        </QueryState>
      </Page>
    </div>
  )
}

function SessionHeaderActions({
  session,
  run,
  title,
}: {
  readonly session: Session
  readonly run: NonNullable<ReturnType<typeof deriveRunState>>
  readonly title: string
}) {
  const served = servedFileUrl(toSessionUrls(session.session_urls))
  return (
    <>
      <StatusChip status={session.status} />
      {run.verb === "stop" ? <StopRecordingAction session={session} label={title} /> : null}
      {run.verb === "open-recording" && served !== null ? (
        <a
          className={buttonClass({ variant: "primary", size: "lg", className: "min-h-11 min-w-11" })}
          href={served}
          target="_blank"
          rel="noreferrer"
        >
          Open recording
          <IconExternal size={14} />
        </a>
      ) : null}
      <SessionOverflow session={session} label={title} live={run.panels.sources} />
    </>
  )
}

function SessionDetailBody({
  session,
  run,
  title,
  durationSeconds,
  configOpen,
  onConfigToggle,
}: {
  readonly session: Session
  readonly run: NonNullable<ReturnType<typeof deriveRunState>>
  readonly title: string
  readonly durationSeconds: number | null
  readonly configOpen: boolean
  readonly onConfigToggle: (open: boolean) => void
}) {
  const names = useNameMaps()
  const urls = toSessionUrls(session.session_urls)
  const evidence = fileEvidence(session, urls)
  const attempts = (session.attempts ?? [])
    .map((raw, index) => toAttemptView(raw, index))
    .sort((a, b) => b.index - a.index)
  const captures = (session.captures ?? [])
    .map((raw, index) => toCaptureView(raw, index))
    .sort((a, b) => a.index - b.index)
  const plan = session.capture_plan ?? []
  const pending = pendingFallbacks(session, names, captures.length, run.panels.sources)
  const hasSource = sourcePanelMode(run, evidence) !== "none"
  const tallMedia = hasSource && sourceFillsBox(run, urls)

  // One rail, in the order an operator asks: what is it doing, what has it
  // done, what is it made of, who can see it. With no player to sit beside —
  // a failed run, a run with no file, a run that published no stream — the same
  // rail stacks down one column rather than leaving a half page of nothing.
  const rail = (
    <>
      <SessionRunPanel
        session={session}
        run={run}
        reason={failureReason(session, attempts)}
        durationSeconds={durationSeconds}
        bytes={capturedBytes(session)}
      />
      <Panel>
        <PanelHead
          title="Timeline"
          actions={plan.length > 1 ? <Tag>{plan.length} in the plan</Tag> : null}
        />
        <PanelBody>
          <SessionTimeline
            captures={captures}
            attempts={attempts}
            pending={pending}
            empty={timelineEmptyText(run)}
          />
        </PanelBody>
      </Panel>
      <SessionConfigPanel
        session={session}
        names={names}
        open={configOpen}
        onToggle={onConfigToggle}
      />
      <SessionAccessPanel session={session} title={title} />
    </>
  )
  const source = hasSource ? (
    <SessionSourcePanel
      session={session}
      names={names}
      run={run}
      evidence={evidence}
      attempts={attempts}
      title={title}
      durationSeconds={durationSeconds}
    />
  ) : null

  if (!tallMedia) {
    return (
      <div className={STACKED}>
        {source}
        {rail}
      </div>
    )
  }

  return (
    <div className={COLUMNS}>
      <div className={HISTORY}>{source}</div>
      <div className={RAIL}>{rail}</div>
    </div>
  )
}
