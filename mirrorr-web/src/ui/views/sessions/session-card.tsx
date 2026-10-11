import { useState, type MouseEvent } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import { isLive } from "@/api/domain/filter-grammar"
import { resolveEntityName } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import { formatDateTime, formatDuration } from "@/api/time"
import { Checkbox, StatusChip } from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { cn } from "@/ui/lib/cn"
import { RemuxProgressBar } from "./remux-progress"
import { SessionPreviewPlayer } from "./session-preview-player"
import { SessionRecordingButton } from "./session-recording-button"
import { SessionStopDeleteButton } from "./session-stop-delete-button"
import { sessionTitle } from "./session-title"
import { SessionUrls, pickPlayableUrl, toSessionUrls } from "./session-urls"

/** Descendants that own their own click — a card click must not hijack them. */
const INTERACTIVE = "a, button, input, label, [role='menu'], [role='menuitem']"

/**
 * One capture run as a media card: a preview player over the session's HLS
 * playlist, its live metadata, and every URL it publishes. Hovering previews
 * the stream where a pointer exists; tapping the play button previews it
 * anywhere, and clicking the rest of the card opens the session.
 */
export function SessionCard({
  session,
  names,
  selected,
  onToggle,
}: {
  readonly session: Session
  readonly names: NameMaps
  readonly selected: boolean
  readonly onToggle: (id: number) => void
}) {
  const [hovering, setHovering] = useState(false)
  const navigate = useNavigate()
  const duration = useLiveDurationSeconds(session.started_at, session.ended_at)
  const live = isLive(session.status)
  const remuxing = session.status === "remuxing" || session.status === "finalizing"
  const urls = toSessionUrls(session.session_urls)
  const playable = pickPlayableUrl(urls)
  const link = { to: "/sessions/$sessionId" as const, params: { sessionId: String(session.id) } }

  function openDetail(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(INTERACTIVE) !== null) return
    if (window.getSelection()?.toString() !== "") return
    void navigate(link)
  }

  return (
    <article
      className={cn("session-card", live && "session-card-live")}
      data-selected={selected}
      onClick={openDetail}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <SessionPreviewPlayer src={playable} loop={!live} hovering={hovering} label={`session #${session.id}`}>
        <div className="session-card-overlay">
          <StatusChip status={session.status} />
          {live ? (
            <span className="session-card-flag" data-live="true">
              Live
            </span>
          ) : duration !== null ? (
            <span className="session-card-flag tnum">{formatDuration(duration)}</span>
          ) : null}
        </div>
      </SessionPreviewPlayer>

      <div className="session-card-body">
        <div className="session-card-head">
          <Checkbox
            aria-label={`Select session #${session.id}`}
            checked={selected}
            onChange={() => onToggle(session.id)}
          />
          <Link className="session-card-title text-truncate" {...link}>
            {sessionTitle(session, names)}
          </Link>
          <span className="session-card-id mono tnum text-dim">#{session.id}</span>
          <span className="session-card-spacer" />
          <SessionRecordingButton session={session} />
          <SessionStopDeleteButton session={session} />
        </div>

        <div className="session-card-source">
          {resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)}
          <span className="text-dim" aria-hidden="true">
            {" → "}
          </span>
          {resolveEntityName(session.engine_name, names.engines, session.engine_id)}
        </div>

        <div className="session-card-meta text-dim">
          <span className="text-truncate">
            {resolveEntityName(session.profile_name, names.profiles, session.profile_id)}
          </span>
          <span>{session.started_at != null ? formatDateTime(session.started_at) : "not started"}</span>
          {__ADMIN__ && session.requester_user_token !== undefined && session.requester_user_token !== "" ? (
            <span className="mono text-truncate" title={session.requester_user_token}>
              {session.requester_user_token}
            </span>
          ) : null}
        </div>

        {remuxing ? <RemuxProgressBar sessionId={session.id} className="flex flex-col gap-2" /> : null}

        {urls.length > 0 ? (
          <SessionUrls urls={urls} className="session-card-urls" />
        ) : (
          <p className="session-card-none text-dim">No media yet — nothing published for this run.</p>
        )}
      </div>
    </article>
  )
}
