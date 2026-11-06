import { Link } from "@tanstack/react-router"
import type { Session } from "@/api/schemas"
import { formatDuration } from "@/api/time"
import {
  buttonClass,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  SkeletonRows,
  StatusChip,
  TimeText,
  type QueryLike,
} from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { useLiveDurationSeconds } from "@/ui/hooks"

/**
 * The run this autorun spawned (or has not spawned yet). The states are
 * exclusive and ordered by the shared gate: skeleton while the query is in
 * flight, `ErrorPanel + Retry` when it failed, and only then the empty copy —
 * "No run yet" over a failed request is the lie AUT-09 names.
 */
export interface LinkedRunPanelProps {
  /** The session list narrowed to this autorun (`?autorun=`). */
  readonly query: QueryLike
  readonly session: Session | null
  /** The autorun is already spent: no run is ever going to appear. */
  readonly spent: boolean
}

function LinkedRun({ session }: { readonly session: Session }) {
  const duration = useLiveDurationSeconds(session.started_at, session.ended_at)
  const started = (session.started_at ?? "") !== ""
  const href = { to: "/sessions/$sessionId" as const, params: { sessionId: String(session.id) } }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={session.status} />
        <Link
          {...href}
          className="tab-stop inline-flex min-h-6 items-center font-medium text-ink hover:text-brand"
        >
          Session #{session.id}
        </Link>
      </div>
      <p className="text-sm text-ink-muted">
        {started ? (
          <>
            Started <TimeText value={session.started_at} />
          </>
        ) : (
          "Not started"
        )}
        {duration === null ? null : (
          <>
            {" · "}
            <span className="mono">{formatDuration(duration)}</span>
          </>
        )}
      </p>
      <Link {...href} className={cn(buttonClass({ variant: "outline", size: "md" }), "min-h-11 self-start")}>
        Open session
      </Link>
    </div>
  )
}

export function LinkedRunPanel({ query, session, spent }: LinkedRunPanelProps) {
  return (
    <Panel>
      <PanelHead title="Linked run" />
      <PanelBody>
        <QueryState
          query={query}
          loading={<SkeletonRows rows={2} cols={2} />}
          isEmpty={session === null}
          empty={
            <p className="text-sm text-ink-muted">
              {spent
                ? "No run was recorded for this autorun."
                : "No run yet — it runs once, at its start time."}
            </p>
          }
          errorMessage="Could not load the run this autorun started"
        >
          {session === null ? null : <LinkedRun session={session} />}
        </QueryState>
      </PanelBody>
    </Panel>
  )
}
