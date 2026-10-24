import { formatBytes, formatDuration } from "@/api/time"
import { StatusChip, Tag } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

export interface StintView {
  readonly index: number
  readonly status: string
  readonly profile: string
  readonly engine: string
  readonly resolver: string
  readonly reason: string | null
  readonly attempts: number | null
  readonly seconds: number | null
  readonly bytes: number | null
  readonly merged: boolean
}

/** Stint records arrive as loose JSON — read defensively, never assume a shape. */
export function toStintView(raw: Record<string, unknown>, fallbackIndex: number): StintView {
  const str = (key: string): string | null => {
    const value = raw[key]
    return typeof value === "string" && value !== "" ? value : null
  }
  const num = (key: string): number | null => {
    const value = raw[key]
    return typeof value === "number" ? value : null
  }
  const index = num("index") ?? fallbackIndex + 1
  return {
    index,
    // A stint's own status: failed, completed, stopped — no inference needed.
    status: str("status") ?? "failed",
    profile: str("profile_name") ?? (raw.profile_id == null ? "—" : `#${String(raw.profile_id)}`),
    engine: str("engine_name") ?? "—",
    resolver: str("resolver_name") ?? "—",
    reason: str("reason"),
    attempts: num("attempts"),
    seconds: num("seconds"),
    bytes: num("bytes"),
    merged: raw.merged === true,
  }
}

function Dot() {
  return <span aria-hidden="true">•</span>
}

/**
 * One source a session ran — its own capture first, then any fallback. A
 * fallback is a different profile, so the row names what actually ran rather
 * than the session's snapshot, and says what that source's media became.
 */
function StintRow({ stint }: { readonly stint: StintView }) {
  const fallback = stint.index > 1
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 min-w-0",
        stint.merged
          ? "border-line-strong bg-surface-2 [box-shadow:inset_2px_0_0_var(--accent)]"
          : "border-line-subtle bg-surface-1",
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="mono tnum text-xs text-dim">#{stint.index}</span>
        <StatusChip status={stint.status} />
        {fallback ? <Tag>Fallback</Tag> : null}
        <span className="text-[13px] font-semibold text-ink text-truncate">{stint.profile}</span>
        <span className="flex-1" />
        {stint.merged ? <Tag accent>In the recording</Tag> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-dim">
        <span className="mono">{stint.engine}</span>
        <span aria-hidden="true">→</span>
        <span className="mono">{stint.resolver}</span>
        {stint.attempts === null ? null : (
          <>
            <Dot />
            <span>
              {stint.attempts} {stint.attempts === 1 ? "attempt" : "attempts"}
            </span>
          </>
        )}
        {stint.seconds === null ? null : (
          <>
            <Dot />
            <span className="mono tnum">{formatDuration(stint.seconds)}</span>
          </>
        )}
        {stint.bytes === null ? null : (
          <>
            <Dot />
            <span className="mono tnum">{formatBytes(stint.bytes)}</span>
          </>
        )}
      </div>

      {stint.reason === null ? null : (
        <p className="text-[13px] leading-snug text-ink-muted [overflow-wrap:anywhere]">
          {stint.reason}
        </p>
      )}
    </li>
  )
}

/**
 * The sources a session ran, in the order it tried them, plus any it has not
 * reached yet. A single-source session that never fell back has nothing to say
 * here and renders nothing.
 */
export function SourcesTimeline({
  stints,
  pending,
  className,
}: {
  readonly stints: readonly StintView[]
  /** Profiles the session will still try if the current source dies. */
  readonly pending: readonly string[]
  readonly className?: string
}) {
  if (stints.length === 0 && pending.length === 0) return null

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none" role="list" aria-label="Session sources">
        {stints.map((stint) => (
          <StintRow key={stint.index} stint={stint} />
        ))}
      </ol>
      {pending.length === 0 ? null : (
        <p className="text-xs text-dim">
          Falls back to {pending.join(" → ")} if this source drops out.
        </p>
      )}
    </div>
  )
}
