import { elapsedSeconds, formatDateTime, formatDateTimePair, formatDuration } from "@/api/time"
import { StatusChip, Tag } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

export interface AttemptView {
  readonly index: number
  readonly status: string
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly exitCode: number | null
  readonly reason: string | null
}

/** Attempts arrive as loose records — read defensively, never assume a shape. */
export function toAttemptView(raw: Record<string, unknown>, fallbackIndex: number): AttemptView {
  const str = (key: string): string | null => {
    const value = raw[key]
    return typeof value === "string" && value !== "" ? value : null
  }
  const num = (key: string): number | null => {
    const value = raw[key]
    return typeof value === "number" ? value : null
  }
  const endedAt = str("ended_at")
  const reason = str("reason") ?? str("error")
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
  }
}

function Dot() {
  return <span aria-hidden="true">•</span>
}

/**
 * One attempt, weighted by what a reader needs first: outcome and how long it
 * ran on the headline, the supervisor's message as the body, the raw
 * timestamps last as labelled facts. Only the newest attempt — the one that
 * decides the session's current state — carries the accent bar and
 * full-strength text; the older ones read as history.
 */
function AttemptRow({
  attempt,
  supersededBy,
}: {
  readonly attempt: AttemptView
  /** Index of the attempt that followed this one, `null` for the newest. */
  readonly supersededBy: number | null
}) {
  const seconds = elapsedSeconds(attempt.startedAt, attempt.endedAt)
  const current = supersededBy === null
  const pair =
    attempt.startedAt !== null && attempt.endedAt !== null
      ? formatDateTimePair(attempt.startedAt, attempt.endedAt)
      : null
  const started =
    pair?.start ?? (attempt.startedAt === null ? "—" : formatDateTime(attempt.startedAt))
  const ended =
    attempt.endedAt === null ? "running" : (pair?.end ?? formatDateTime(attempt.endedAt))

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 min-w-0",
        current
          ? "border-line-strong bg-surface-2 [box-shadow:inset_2px_0_0_var(--accent)]"
          : "border-line-subtle bg-surface-1",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="mono tnum text-xs text-dim">#{attempt.index}</span>
        <StatusChip status={attempt.status} />
        {current ? <Tag accent>Latest</Tag> : null}
        <span className="flex-1" />
        {seconds === null ? null : (
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-2xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              ran
            </span>
            <span className="mono tnum text-xs font-semibold text-ink">
              {formatDuration(seconds)}
            </span>
          </span>
        )}
      </div>

      {attempt.reason === null ? null : (
        <p
          className={cn(
            "text-[13px] leading-snug [overflow-wrap:anywhere]",
            current ? "text-ink" : "text-ink-muted",
          )}
        >
          {attempt.reason}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-dim">
          {attempt.exitCode === null ? null : (
            <span className="mono tnum">exit {attempt.exitCode}</span>
          )}
          {attempt.exitCode === null || supersededBy === null ? null : <Dot />}
          {supersededBy === null ? null : <span>superseded by #{supersededBy}</span>}
        </div>

        <dl className="grid grid-cols-[3.75rem_1fr] gap-x-2 text-xs">
          <dt className="text-dim">started</dt>
          <dd className="mono tnum text-ink-muted">{started}</dd>
          <dt className="text-dim">ended</dt>
          <dd className={attempt.endedAt === null ? "text-ink-muted" : "mono tnum text-ink-muted"}>
            {ended}
          </dd>
        </dl>
      </div>
    </li>
  )
}

/**
 * The attempt timeline, newest first — one row per resolver-join/engine-start
 * cycle, with `retry_attempts` on the session equal to the highest index.
 */
export function AttemptsTimeline({
  attempts,
  className,
}: {
  readonly attempts: readonly AttemptView[]
  readonly className?: string
}) {
  if (attempts.length === 0) {
    return <p className="text-dim">Waiting for the supervisor — attempt 1 not started yet.</p>
  }

  return (
    <ol
      className={cn(
        "flex flex-col gap-2 m-0 p-0 list-none max-h-[480px] overflow-y-auto",
        className,
      )}
      role="list"
      aria-label="Attempt timeline"
    >
      {attempts.map((attempt, index) => (
        <AttemptRow
          key={attempt.index}
          attempt={attempt}
          supersededBy={index === 0 ? null : attempts[index - 1].index}
        />
      ))}
    </ol>
  )
}
