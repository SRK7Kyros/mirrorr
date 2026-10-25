import { formatBytes, formatDuration } from "@/api/time"
import { summariseConfig } from "@/api/domain/fallback-sources"
import { StatusChip, Tag } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

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

/** Capture records arrive as loose JSON — read defensively, never assume a shape. */
export function toCaptureView(raw: Record<string, unknown>, fallbackIndex: number): CaptureView {
  const str = (key: string): string | null => {
    const value = raw[key]
    return typeof value === "string" && value !== "" ? value : null
  }
  const num = (key: string): number | null => {
    const value = raw[key]
    return typeof value === "number" ? value : null
  }
  const index = num("index") ?? fallbackIndex + 1
  const isSource = raw.source === "resolver"
  const rawConfig = raw.resolver_config
  const config =
    isSource && typeof rawConfig === "object" && rawConfig !== null
      ? summariseConfig(rawConfig as Record<string, unknown>)
      : ""
  return {
    index,
    // A capture's own status: failed, completed, stopped — no inference needed.
    status: str("status") ?? "failed",
    kind: isSource ? "source" : "profile",
    profile: isSource
      ? (str("resolver_name") ?? "Source")
      : (str("profile_name") ?? (raw.profile_id == null ? "—" : `#${String(raw.profile_id)}`)),
    engine: str("engine_name") ?? "—",
    resolver: str("resolver_name") ?? "—",
    config: config === "" ? null : config,
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
function CaptureRow({ capture }: { readonly capture: CaptureView }) {
  const fallback = capture.index > 1
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 min-w-0",
        capture.merged
          ? "border-line-strong bg-surface-2 [box-shadow:inset_2px_0_0_var(--accent)]"
          : "border-line-subtle bg-surface-1",
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="mono tnum text-xs text-dim">#{capture.index}</span>
        <StatusChip status={capture.status} />
        {fallback ? <Tag>Fallback</Tag> : null}
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
        <span aria-hidden="true">→</span>
        <span className="mono">{capture.resolver}</span>
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
    </li>
  )
}

/**
 * The captures a session ran, in the order it tried them, plus any it has not
 * reached yet. A single-source session that never fell back has nothing to say
 * here and renders nothing.
 */
export function CapturesTimeline({
  captures,
  pending,
  className,
}: {
  readonly captures: readonly CaptureView[]
  /** Profiles the session will still try if the current source dies. */
  readonly pending: readonly string[]
  readonly className?: string
}) {
  if (captures.length === 0 && pending.length === 0) return null

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none" role="list" aria-label="Session captures">
        {captures.map((capture) => (
          <CaptureRow key={capture.index} capture={capture} />
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
