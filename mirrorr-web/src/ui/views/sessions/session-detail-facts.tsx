import type { ReactNode } from "react"
import { resolveEntityName } from "@/api/query-keys"
import type { NameMaps } from "@/api"
import type { RunStateView } from "@/api/domain/run-state"
import type { Session } from "@/api/schemas"
import { formatBytes, formatDuration } from "@/api/time"
import {
  Banner,
  IconChevronRight,
  JsonView,
  Panel,
  PanelBody,
  PanelHead,
  TimeText,
} from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { useResourceAccessSlot, AccessButton } from "@/ui/views/shared/resource-access-slot"
import {
  attemptsUsed,
  durationLabel,
  FAILED_FIX,
  stateSentence,
} from "./session-detail-model"
import { RemuxProgressBar } from "./remux-progress"
import { SessionTelemetryReadout } from "./session-telemetry"

/**
 * The right-hand rail of SCR-04: Run, Timeline, Config, Access — one home per
 * value. The status chip stays in the header, so nothing here repeats the label;
 * and the full engine → resolver → profile chain lives only in Config, which is
 * what lets the header subtitle be the two words SDR-04 asks for.
 *
 * Run used to be two panels — a `Status` holding one sentence and a `Facts`
 * holding seven rows — so the same question ("is it healthy, and how far along?")
 * cost two panel heads and read as two unrelated answers. They are one panel
 * because they are one answer; the heading count is also what lets the rail hold
 * the timeline without towering over the player.
 */

function FactRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs uppercase tracking-[0.05em] text-ink-dim">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-base text-ink tabular-nums">{children}</dd>
    </div>
  )
}

export function SessionRunPanel({
  session,
  run,
  reason,
  durationSeconds,
  bytes,
}: {
  readonly session: Session
  readonly run: RunStateView
  readonly reason: string
  readonly durationSeconds: number | null
  readonly bytes: number | null
}) {
  const retries = session.retry_attempts ?? 0
  return (
    <Panel>
      <PanelHead title="Run" />
      <PanelBody className="@container flex flex-col gap-4">
        <p className="text-md leading-normal text-ink-muted">{stateSentence(run)}</p>
        {run.state === "failed" ? (
          <Banner kind="danger" title={reason}>
            {FAILED_FIX}
          </Banner>
        ) : null}
        {run.state === "finalising" ? (
          <RemuxProgressBar sessionId={session.id} className="flex flex-col gap-2" />
        ) : null}
        {run.panels.live && run.state !== "finalising" ? (
          <SessionTelemetryReadout sessionId={session.id} />
        ) : null}
        <dl className="m-0 flex flex-col gap-2 border-t border-line-subtle pt-3 @2xl:grid @2xl:grid-cols-3 @2xl:gap-x-8 @2xl:gap-y-2 @5xl:grid-cols-5">
          <FactRow label={durationLabel(run)}>
            {durationSeconds === null ? "—" : formatDuration(durationSeconds)}
          </FactRow>
          <FactRow label="Started">
            <TimeText value={session.started_at} fallback="not started" />
          </FactRow>
          <FactRow label="Ended">
            <TimeText value={session.ended_at} />
          </FactRow>
          <FactRow label="Recording">{session.recording === true ? "On" : "Off"}</FactRow>
          <FactRow label="Attempts">{attemptsUsed(session)}</FactRow>
          {retries > 0 ? <FactRow label="Retries">{retries}</FactRow> : null}
          <FactRow label="Size">{bytes === null ? "—" : formatBytes(bytes)}</FactRow>
          {__ADMIN__ ? (
            <FactRow label="Owner">
              {session.requester_user_token !== undefined && session.requester_user_token !== ""
                ? session.requester_user_token
                : "—"}
            </FactRow>
          ) : null}
        </dl>
      </PanelBody>
    </Panel>
  )
}

/** A labelled, copyable snapshot block — collapsed until asked for. */
function ConfigJson({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-[0.05em] text-ink-dim">{label}</span>
      <JsonView value={value} label={label} />
    </div>
  )
}

export function SessionConfigPanel({
  session,
  names,
  open,
  onToggle,
}: {
  readonly session: Session
  readonly names: NameMaps
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
}) {
  const engine = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  const resolver = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
  const profile = resolveEntityName(session.profile_name, names.profiles, session.profile_id)
  const hasResolverConfig =
    session.resolver_config !== undefined && Object.keys(session.resolver_config).length > 0
  const hasRetryConfig =
    session.retry_config !== undefined && Object.keys(session.retry_config).length > 0

  return (
    <Panel>
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary
          className={cn(
            "tab-stop flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden",
            open && "border-b border-line-subtle",
          )}
        >
          <h2 className="text-md font-semibold leading-tight">Config</h2>
          <span className="flex items-center gap-2 text-sm text-dim">
            {open ? "The full chain and snapshot" : "Engine, resolver, profile, retry"}
            <IconChevronRight size={14} className={cn("shrink-0", open && "rotate-90")} />
          </span>
        </summary>
        <PanelBody className="@container">
          <div className="flex flex-col gap-4">
            <dl className="m-0 flex flex-col gap-2 @2xl:grid @2xl:grid-cols-2 @2xl:gap-x-8">
              <FactRow label="Engine">
                <span className="mono">
                  {engine === "" ? "—" : engine} · #{session.engine_id}
                </span>
              </FactRow>
              <FactRow label="Resolver">
                <span className="mono">
                  {resolver === "" ? "—" : resolver} · #{session.resolver_id}
                </span>
              </FactRow>
              <FactRow label="Profile">
                <span className="mono">
                  {profile === "" ? "—" : profile}
                  {session.profile_id == null ? "" : ` · #${session.profile_id}`}
                </span>
              </FactRow>
              <FactRow label="Retry mode">{session.retry_mode ?? "—"}</FactRow>
              <FactRow label="Session id">#{session.id}</FactRow>
            </dl>
            {hasResolverConfig && session.resolver_config !== undefined ? (
              <ConfigJson label="Resolver config" value={session.resolver_config} />
            ) : null}
            {hasRetryConfig && session.retry_config !== undefined ? (
              <ConfigJson label="Retry config" value={session.retry_config} />
            ) : null}
          </div>
        </PanelBody>
      </details>
    </Panel>
  )
}

/** Admin builds only — a build without the access slot renders no empty panel. */
export function SessionAccessPanel({
  session,
  title,
}: {
  readonly session: Session
  readonly title: string
}) {
  const slot = useResourceAccessSlot()
  if (slot === null) return null
  return (
    <Panel>
      <PanelHead title="Access" />
      <PanelBody>
        <div className="flex items-center justify-between gap-3">
          <span className="text-base text-ink-muted">Who can view or control this run</span>
          <AccessButton resourceType="session" id={session.id} label={title} />
        </div>
      </PanelBody>
    </Panel>
  )
}
