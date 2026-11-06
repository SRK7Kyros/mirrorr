import { Link, useNavigate } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import { autorunIssue } from "@/api/domain/autorun-issue"
import { chainOf, mapNaming, rungLabel } from "@/api/domain/fallback-chain"
import { deriveRunState } from "@/api/domain/run-state"
import { resolveEntityName } from "@/api/query-keys"
import type { Autorun } from "@/api/schemas"
import {
  elapsedSeconds,
  formatCountdown,
  formatDuration,
  formatTimeZoneLabel,
  formatWindow,
} from "@/api/time"
import { CardHeaderActions, EntityCard, StatusChip, Tag } from "@/ui/components"
import { useNowTick } from "@/ui/hooks"
import { cn } from "@/ui/lib/cn"
import { AccessButton } from "@/ui/views/shared/resource-access-slot"
import { AutorunActionsMenu } from "./autorun-actions"

/**
 * One autorun as a card — the Autoruns recipe of `plan.md` §2.2a:
 *
 *   header (chip + `⋯`) · hero (countdown, or why it is flagged) · one window
 *   block · identity (name · slug · resolver → engine · profile)
 *
 * There is no `media` slot: nothing exists before the run, so the box the
 * Sessions card fills has nothing honest to put here and collapses. The window
 * block is the single `detail` slot — it must not grow a second copy of the
 * status or the name, and it must stay three lines in every state so the grid
 * never changes height when a schedule is flagged or retires.
 */

/** When the autorun will next run — the re-armed time if set, else its start. */
export function runTarget(autorun: Autorun): string {
  const next = autorun.next_run_at
  return next !== null && next !== undefined && next !== "" ? next : autorun.start_time
}

/**
 * The countdown text, but only while it *is* a countdown. `formatCountdown`
 * degrades to "starting…" once the target has passed; that sentence is not a
 * hero metric, so the caller falls back to the window's duration instead.
 */
function futureCountdown(autorun: Autorun, now: Date): string | null {
  const text = formatCountdown(runTarget(autorun), now)
  return text.startsWith("starts in ~") ? text : null
}

const HERO = "text-2xl font-semibold tabular-nums text-ink"
const HERO_ATTENTION = "line-clamp-2 text-md font-semibold text-warning"
const EYEBROW = "text-xs font-medium tracking-[0.06em] uppercase text-dim"
const BLOCK = "rounded-md border px-3 py-2"
const ZONE_LABEL = formatTimeZoneLabel()

/** The fix line for a flagged schedule — the reason itself is the hero. */
const FIX = "Edit it and save to clear the flag."

/** A one-shot schedule that has run cannot be re-armed, so it is retired. */
const RETIRED = "Ran once — retired; it will not run again."

function WindowBlock({
  autorun,
  flagged,
  retired,
}: {
  readonly autorun: Autorun
  readonly flagged: boolean
  readonly retired: boolean
}) {
  const text = formatWindow(autorun.start_time, autorun.end_time)
  const duration = elapsedSeconds(autorun.start_time, autorun.end_time)
  const meta = flagged
    ? FIX
    : retired
      ? RETIRED
      : duration === null
        ? "—"
        : `${formatDuration(duration)} long`

  return (
    <div
      data-slot="window-block"
      className={cn(
        BLOCK,
        flagged
          ? "border-[color:rgba(227,179,65,0.35)] bg-warning-dim"
          : "border-line bg-surface-3",
      )}
    >
      <div className={EYEBROW}>{text?.date ?? "—"}</div>
      <div className="text-base font-semibold leading-snug text-ink">
        {text?.time ?? "—"}
        {text === null ? null : (
          <span
            data-zone-label
            className="ml-1.5 align-middle text-xs font-normal whitespace-nowrap text-dim"
          >
            {ZONE_LABEL}
          </span>
        )}
      </div>
      <div className={cn("text-sm", flagged ? "font-medium text-warning" : "text-dim")}>{meta}</div>
    </div>
  )
}

export function AutorunCard({
  autorun,
  names,
  selected,
  selectMode,
  onToggle,
}: {
  readonly autorun: Autorun
  readonly names: NameMaps
  readonly selected: boolean
  /** No checkbox at rest — the toolbar's `Select` toggle is the only way in. */
  readonly selectMode: boolean
  readonly onToggle: (id: number) => void
}) {
  const navigate = useNavigate()
  // The timer lives on the card so a tick repaints one countdown, not the grid.
  const now = useNowTick()
  const run = deriveRunState({
    status: autorun.status,
    ...(autorun.recording === undefined ? {} : { recording: autorun.recording }),
    ...(autorun.issue === undefined ? {} : { issue: autorun.issue }),
  })
  const issue = autorunIssue(autorun)
  const retired = run.state === "completed" || run.state === "failed"
  const countdown = issue === null && run.state === "scheduled" ? futureCountdown(autorun, now) : null
  const duration = elapsedSeconds(autorun.start_time, autorun.end_time)

  const resolver = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)
  const engine = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
  const profile = resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id)
  const fallbacks = chainOf(autorun).map((rung) =>
    rungLabel(
      rung,
      mapNaming({
        engines: names.engines,
        resolvers: names.resolvers,
        profiles: names.profiles,
      }),
    ),
  )
  const owner = autorun.requester_user_token
  const nameId = `autorun-name-${autorun.id}`

  const hero =
    issue !== null ? (
      <span className={HERO_ATTENTION}>{issue.title}</span>
    ) : (
      <span className={HERO}>
        {countdown ?? (duration === null ? "—" : formatDuration(duration))}
      </span>
    )

  return (
    <EntityCard
      className="entity-card"
      labelledBy={nameId}
      selected={selected}
      issue={issue?.code ?? null}
      onOpen={() => {
        void navigate({ to: "/autoruns/$autorunId", params: { autorunId: String(autorun.id) } })
      }}
      header={
        <CardHeaderActions
          selectLabel={`Select ${autorun.user_friendly_name}`}
          selected={selected}
          onToggleSelect={() => onToggle(autorun.id)}
          selectMode={selectMode}
        >
          <StatusChip status={autorun.status} />
          {autorun.recording === true ? <Tag accent>REC</Tag> : null}
          <span className="flex-1" />
          <AccessButton
            resourceType="autorun"
            id={autorun.id}
            label={autorun.user_friendly_name}
          />
          <AutorunActionsMenu autorun={autorun} />
        </CardHeaderActions>
      }
      hero={hero}
      detail={<WindowBlock autorun={autorun} flagged={issue !== null} retired={retired} />}
      identity={
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              id={nameId}
              to="/autoruns/$autorunId"
              params={{ autorunId: String(autorun.id) }}
              className="tab-stop inline-flex min-h-6 min-w-0 items-center truncate font-semibold text-ink"
            >
              {autorun.user_friendly_name}
            </Link>
            <Tag
              className="max-w-[45%] shrink-0 overflow-hidden text-ellipsis"
              title={autorun.snake_case_name}
            >
              {autorun.snake_case_name}
            </Tag>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-dim">
            <span className="min-w-0 truncate text-ink [overflow-wrap:anywhere]">
              {resolver}
              <span className="text-dim" aria-hidden="true">
                {" → "}
              </span>
              {engine}
            </span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{profile}</span>
            {fallbacks.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className="text-ink-muted"
                  title={`Fallbacks: ${fallbacks.join(" → ")}`}
                >
                  {fallbacks.length} fallback{fallbacks.length === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
            {__ADMIN__ ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="mono min-w-0 truncate" title={owner}>
                  {owner !== undefined && owner !== "" ? owner : "—"}
                </span>
              </>
            ) : null}
          </div>
        </div>
      }
    />
  )
}
