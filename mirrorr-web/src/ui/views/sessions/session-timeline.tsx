import {
  elapsedSeconds,
  formatBytes,
  formatDateTime,
  formatDateTimePair,
  formatDuration,
} from "@/api/time"
import { summariseConfig } from "@/api/domain/fallback-sources"
import { StatusChip, Tag } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

/**
 * A session's history is one story told twice: *what sources it tried* (a
 * capture) and *how many times each one was attempted*. They were two panels
 * until Oct 26 2026, so the same failure read as two unrelated rows; the
 * timeline here is the single view — a capture is the group, its attempts are
 * the rows inside it.
 */

export interface AttemptView {
  readonly index: number
  /** Which capture of the plan this attempt ran under; the session's own is 1. */
  readonly capture: number
  readonly status: string
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly exitCode: number | null
  readonly reason: string | null
}

export interface CaptureView {
  readonly index: number
  readonly status: string
  /** What the capture ran: a profile whole, or a resolver on the run's own engine. */
  readonly kind: "profile" | "source"
  readonly profile: string
  readonly engine: string
  readonly resolver: string
  /** A source capture's own config, summarised — two rungs on one resolver differ here. */
  readonly config: string | null
  readonly reason: string | null
  readonly attempts: number | null
  readonly seconds: number | null
  readonly bytes: number | null
  readonly merged: boolean
}

export interface TimelineGroup {
  /** `null` for a run that recorded attempts before captures existed. */
  readonly capture: CaptureView | null
  readonly index: number
  /** Newest first, the order the supervisor writes them in reverse. */
  readonly attempts: readonly AttemptView[]
}

/** Both payloads arrive as loose JSON — read defensively, never assume a shape. */
function str(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  return typeof value === "string" && value !== "" ? value : null
}

function num(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key]
  return typeof value === "number" ? value : null
}

export function toAttemptView(raw: Record<string, unknown>, fallbackIndex: number): AttemptView {
  const endedAt = str(raw, "ended_at")
  const reason = str(raw, "reason") ?? str(raw, "error")
  return {
    index: num(raw, "index") ?? num(raw, "attempt") ?? fallbackIndex + 1,
    capture: num(raw, "capture") ?? 1,
    // The record has no status field. No `ended_at` means it is still running;
    // any reason but a user stop is a failure. A stop maps to `completed`,
    // matching the status a stopped session itself ends on.
    status:
      endedAt === null
        ? "active"
        : reason !== null && reason !== "stopped"
          ? "failed"
          : "completed",
    startedAt: str(raw, "started_at"),
    endedAt,
    exitCode: num(raw, "returncode") ?? num(raw, "exit_code"),
    reason,
  }
}

export function toCaptureView(raw: Record<string, unknown>, fallbackIndex: number): CaptureView {
  const index = num(raw, "index") ?? fallbackIndex + 1
  const isSource = raw.source === "resolver"
  const rawConfig = raw.resolver_config
  const config =
    isSource && typeof rawConfig === "object" && rawConfig !== null
      ? summariseConfig(rawConfig as Record<string, unknown>)
      : ""
  return {
    index,
    // A capture's own status: failed, completed, stopped — no inference needed.
    status: str(raw, "status") ?? "failed",
    kind: isSource ? "source" : "profile",
    profile: isSource
      ? (str(raw, "resolver_name") ?? "Source")
      : (str(raw, "profile_name") ?? (raw.profile_id == null ? "—" : `#${String(raw.profile_id)}`)),
    engine: str(raw, "engine_name") ?? "—",
    resolver: str(raw, "resolver_name") ?? "—",
    config: config === "" ? null : config,
    reason: str(raw, "reason"),
    attempts: num(raw, "attempts"),
    seconds: num(raw, "seconds"),
    bytes: num(raw, "bytes"),
    merged: raw.merged === true,
  }
}

/**
 * Fold both records into one ordered list: every capture the session recorded,
 * each holding the attempts that ran under it. An attempt whose capture was
 * never recorded (a session captured by a build that predates them) keeps its
 * own group rather than disappearing.
 */
export function groupTimeline(
  captures: readonly CaptureView[],
  attempts: readonly AttemptView[],
): readonly TimelineGroup[] {
  const recorded = new Map<number, CaptureView>()
  for (const capture of captures) recorded.set(capture.index, capture)

  const buckets = new Map<number, AttemptView[]>()
  for (const attempt of attempts) {
    const bucket = buckets.get(attempt.capture)
    if (bucket === undefined) buckets.set(attempt.capture, [attempt])
    else bucket.push(attempt)
  }

  const indices = [...new Set([...recorded.keys(), ...buckets.keys()])].sort((a, b) => a - b)
  return indices.map((index) => ({
    capture: recorded.get(index) ?? null,
    index,
    attempts: [...(buckets.get(index) ?? [])].sort((a, b) => b.index - a.index),
  }))
}

function Dot() {
  return <span aria-hidden="true">•</span>
}

/** One attempt inside its capture: outcome and run time first, timestamps last. */
function AttemptRow({
  attempt,
  supersededBy,
  latest,
}: {
  readonly attempt: AttemptView
  /** Index of the attempt that followed this one, `null` for the newest. */
  readonly supersededBy: number | null
  /** The newest attempt of the whole run decides the session's current state. */
  readonly latest: boolean
}) {
  const seconds = elapsedSeconds(attempt.startedAt, attempt.endedAt)
  const pair =
    attempt.startedAt !== null && attempt.endedAt !== null
      ? formatDateTimePair(attempt.startedAt, attempt.endedAt)
      : null
  const started =
    pair?.start ?? (attempt.startedAt === null ? "—" : formatDateTime(attempt.startedAt))
  const ended =
    attempt.endedAt === null ? "running" : (pair?.end ?? formatDateTime(attempt.endedAt))

  return (
    <li className={cn("flex flex-col gap-1 min-w-0", latest && "text-ink")}>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="mono tnum text-xs text-ink-faint">#{attempt.index}</span>
        <StatusChip status={attempt.status} />
        {latest ? <Tag accent>Latest</Tag> : null}
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
            latest ? "text-ink" : "text-ink-muted",
          )}
        >
          {attempt.reason}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-dim">
        {attempt.exitCode === null ? null : (
          <>
            <span className="mono tnum">exit {attempt.exitCode}</span>
            <Dot />
          </>
        )}
        <span>started</span>
        <span className="mono tnum text-ink-muted">{started}</span>
        <Dot />
        <span>ended</span>
        <span className="mono tnum text-ink-muted">{ended}</span>
        {supersededBy === null ? null : (
          <>
            <Dot />
            <span>superseded by #{supersededBy}</span>
          </>
        )}
      </div>
    </li>
  )
}

/** A capture's headline: what ran, what it was pointed at, what it produced. */
function CaptureHead({ capture }: { readonly capture: CaptureView }) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="mono tnum text-xs text-dim">#{capture.index}</span>
        <StatusChip status={capture.status} />
        {capture.index > 1 ? <Tag>Fallback</Tag> : null}
        {capture.kind === "source" ? <Tag>Source</Tag> : null}
        <span className="text-[13px] font-semibold text-ink text-truncate">{capture.profile}</span>
        {capture.config === null ? null : (
          <span className="mono text-xs text-dim text-truncate">{capture.config}</span>
        )}
        <span className="flex-1" />
        {capture.merged ? <Tag accent>In the recording</Tag> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-dim">
        <span className="mono">{capture.engine}</span>
        {capture.kind === "source" ? null : (
          <>
            <span aria-hidden="true">→</span>
            <span className="mono">{capture.resolver}</span>
          </>
        )}
        {capture.attempts === null ? null : (
          <>
            <Dot />
            <span>
              {capture.attempts} {capture.attempts === 1 ? "attempt" : "attempts"}
            </span>
          </>
        )}
        {capture.seconds === null ? null : (
          <>
            <Dot />
            <span className="mono tnum">{formatDuration(capture.seconds)}</span>
          </>
        )}
        {capture.bytes === null ? null : (
          <>
            <Dot />
            <span className="mono tnum">{formatBytes(capture.bytes)}</span>
          </>
        )}
      </div>

      {capture.reason === null ? null : (
        <p className="text-[13px] leading-snug text-ink-muted [overflow-wrap:anywhere]">
          {capture.reason}
        </p>
      )}
    </>
  )
}

function CaptureGroup({
  group,
  successor,
  newestIndex,
}: {
  readonly group: TimelineGroup
  readonly successor: ReadonlyMap<number, number>
  readonly newestIndex: number | null
}) {
  const { capture, index, attempts } = group
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border px-3 py-2.5 min-w-0",
        capture?.merged === true
          ? "border-line-strong bg-surface-2 [box-shadow:inset_2px_0_0_var(--accent)]"
          : "border-line-subtle bg-surface-1",
      )}
    >
      {capture === null ? null : <CaptureHead capture={capture} />}

      {attempts.length === 0 ? (
        <p className="text-xs text-dim">No attempt recorded for this capture.</p>
      ) : (
        <ol
          className="flex flex-col gap-2 m-0 p-0 pl-2.5 list-none border-l border-line-subtle"
          role="list"
          aria-label={`Attempts in capture ${index}`}
        >
          {attempts.map((attempt) => (
            <AttemptRow
              key={attempt.index}
              attempt={attempt}
              supersededBy={successor.get(attempt.index) ?? null}
              latest={attempt.index === newestIndex}
            />
          ))}
        </ol>
      )}
    </li>
  )
}

/**
 * Everything a session did, in the order it did it: each capture it tried with
 * the attempts that ran under it, then the sources it has not reached yet. A
 * session that has not started yet says so instead of rendering an empty panel.
 */
export function SessionTimeline({
  captures,
  attempts,
  pending,
  className,
}: {
  readonly captures: readonly CaptureView[]
  readonly attempts: readonly AttemptView[]
  /** Sources the session will still try if the current one drops out. */
  readonly pending: readonly string[]
  readonly className?: string
}) {
  const groups = groupTimeline(captures, attempts)

  // Supersession runs across captures, not inside one: the attempt after a
  // capture's last is the next capture's first.
  const ascending = [...attempts].sort((a, b) => a.index - b.index)
  const successor = new Map<number, number>()
  ascending.forEach((attempt, position) => {
    const next = ascending[position + 1]
    if (next !== undefined) successor.set(attempt.index, next.index)
  })
  const newestIndex = ascending.at(-1)?.index ?? null

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {groups.length === 0 ? (
        <p className="text-dim">Waiting for the supervisor — attempt 1 not started yet.</p>
      ) : (
        <ol
          className="flex flex-col gap-2 m-0 p-0 list-none max-h-[560px] overflow-y-auto"
          role="list"
          aria-label="Session timeline"
        >
          {groups.map((group) => (
            <CaptureGroup
              key={group.index}
              group={group}
              successor={successor}
              newestIndex={newestIndex}
            />
          ))}
        </ol>
      )}
      {pending.length === 0 ? null : (
        <p className="text-xs text-dim">
          Falls back to {pending.join(" → ")} if this source drops out.
        </p>
      )}
    </div>
  )
}
