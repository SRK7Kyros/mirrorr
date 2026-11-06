import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import { deriveRunState } from "@/api/domain/run-state"
import { resolveEntityName } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import { formatDuration } from "@/api/time"
import {
  CardHeaderActions,
  EntityCard,
  RowActions,
  StatusChip,
  TimeText,
} from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { AccessButton } from "@/ui/views/shared/resource-access-slot"
import { SessionMedia, attemptCount, latestCapture } from "./session-media"
import { SessionRecordingButton } from "./session-recording-button"
import { SessionStopDeleteButton } from "./session-stop-delete-button"
import { useSessionDeleteAction } from "./session-delete-action"
import { sessionTitle } from "./session-title"
import { SessionUrls, toSessionUrls } from "./session-urls"

/**
 * One capture run as an `EntityCard` — the Sessions recipe of plan §2.2a:
 *
 *   header (chip · access · `⋯`) · media (frame / cover / plate, always 16:9) ·
 *   hero (elapsed · duration · the failure reason) · detail (published URLs) ·
 *   identity (title · `#id` · resolver → engine · profile · started) ·
 *   footer (record toggle + the inline `Stop` while the run is live)
 *
 * Every value the old card printed still has a home here: the chip carries the
 * status, the hero carries the elapsed clock and names it `Live`, and the plate
 * carries the facts a state with no playable file can still prove (reason,
 * attempts, bytes, ended-at, whether the file was kept).
 */

const HERO = "text-2xl leading-none font-semibold tabular-nums text-ink"
const HERO_LABEL = "text-2xs font-semibold tracking-[0.06em] uppercase text-dim"
const HERO_REASON = "line-clamp-2 text-md font-semibold text-danger"

export function SessionCard({
  session,
  names,
  selected,
  selectMode = false,
  onToggle,
}: {
  readonly session: Session
  readonly names: NameMaps
  readonly selected: boolean
  /** No checkbox at rest — the toolbar's `Select` toggle is the only way in. */
  readonly selectMode?: boolean
  readonly onToggle: (id: number) => void
}) {
  const [hovering, setHovering] = useState(false)
  const navigate = useNavigate()
  const duration = useLiveDurationSeconds(session.started_at, session.ended_at)
  const run = deriveRunState({
    status: session.status,
    recording: session.recording,
    hasRecording: session.status === "completed" || session.status === "remuxing" || session.status === "finalizing",
  })
  const urls = toSessionUrls(session.session_urls)
  const title = sessionTitle(session, names)
  const nameId = `session-${session.id}-name`
  // The title falls back to the id, and the profile is often what names the
  // run — printing either a second time is noise, not information.
  const titleIsId = title === `#${session.id}`
  const profileLabel = resolveEntityName(session.profile_name, names.profiles, session.profile_id)
  const profileRepeatsTitle = profileLabel === "" || profileLabel === title
  const resolver = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
  const engine = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  const link = { to: "/sessions/$sessionId" as const, params: { sessionId: String(session.id) } }
  const openDetail = () => {
    void navigate(link)
  }

  // `stop` is the only status action that belongs on the card body itself; every
  // other verb lives in `⋯`, so the card never grows a row of buttons.
  const canStop = run.verb === "stop"
  const remove = useSessionDeleteAction(session)

  const menuActions = [
    { label: "Open session", onSelect: openDetail },
    ...(remove.action === null ? [] : [remove.action]),
  ]

  const hero = (() => {
    if (run.hero === "elapsed") {
      return (
        <div className="flex items-baseline gap-2">
          <span className={HERO}>{duration === null ? "—" : formatDuration(duration)}</span>
          {/* The old media overlay said `Live`; that fact keeps a home here. */}
          <span className={HERO_LABEL}>{run.state === "starting" ? "Starting" : "Live"}</span>
        </div>
      )
    }
    if (run.hero === "reason") {
      const reason = latestCapture(session)?.reason ?? "Failed — the record states no reason"
      const attempts = attemptCount(session)
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <span className={HERO_REASON}>{reason}</span>
          <span className="text-sm text-dim tabular-nums">
            {attempts} attempt{attempts === 1 ? "" : "s"} used
          </span>
        </div>
      )
    }
    if (run.hero === "duration") {
      return (
        <div className="flex items-baseline gap-2">
          <span className={HERO}>{duration === null ? "—" : formatDuration(duration)}</span>
          <span className={HERO_LABEL}>
            {run.state === "finalising" ? "Elapsed" : "Recorded"}
          </span>
        </div>
      )
    }
    return (
      <div className="flex items-baseline gap-2">
        <span className={HERO}>—</span>
        <span className={HERO_LABEL}>{run.state === "scheduled" ? "Not started" : "No clock"}</span>
      </div>
    )
  })()

  return (
    <div
      className="h-full min-w-0"
      data-id={session.id}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <EntityCard
        className="entity-card session-card"
        labelledBy={nameId}
        selected={selected}
        issue={run.state === "failed" ? "failed" : null}
        onOpen={openDetail}
        header={
          <>
            <CardHeaderActions
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={() => onToggle(session.id)}
              selectLabel={`Select session #${session.id}`}
            >
              <StatusChip status={session.status} />
            </CardHeaderActions>
            <AccessButton resourceType="session" id={session.id} label={title} />
            <RowActions
              label={`Actions for session #${session.id}`}
              actions={menuActions}
            />
          </>
        }
        media={
          <SessionMedia
            session={session}
            names={names}
            run={run}
            durationSeconds={duration}
            hovering={hovering}
            title={title}
          />
        }
        hero={hero}
        detail={urls.length > 0 ? <SessionUrls urls={urls} /> : undefined}
        identity={
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                id={nameId}
                className="tab-stop inline-flex min-h-6 min-w-0 items-center truncate font-semibold text-ink"
                {...link}
              >
                {title}
              </Link>
              {titleIsId ? null : (
                <span className="shrink-0 font-mono text-xs tabular-nums text-dim">
                  #{session.id}
                </span>
              )}
            </div>
            <span className="min-w-0 truncate text-sm text-dim [overflow-wrap:anywhere]">
              {resolver}
              <span aria-hidden="true">{" → "}</span>
              {engine}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-dim">
              {profileRepeatsTitle ? null : (
                <>
                  <span className="min-w-0 truncate">{profileLabel}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <TimeText value={session.started_at} fallback="not started" />
              {__ADMIN__ && session.requester_user_token !== undefined && session.requester_user_token !== "" ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="mono min-w-0 truncate" title={session.requester_user_token}>
                    {session.requester_user_token}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        }
        footer={
          canStop ? (
            <div className="flex w-full items-center gap-2">
              <SessionRecordingButton session={session} />
              <span className="flex-1" />
              <SessionStopDeleteButton session={session} />
            </div>
          ) : undefined
        }
      />
      {remove.dialog}
    </div>
  )
}
