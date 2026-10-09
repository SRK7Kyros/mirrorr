import { useState } from "react"
import { Link } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import { isLive } from "@/api/domain/filter-grammar"
import { resolveEntityName } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import { formatDateTime, formatDuration } from "@/api/time"
import { Checkbox, IconPlay, StatusChip, Tag } from "@/ui/components"
import { useLiveDurationSeconds } from "@/ui/hooks"
import { cn } from "@/ui/lib/cn"
import { RemuxProgressBar } from "./remux-progress"
import { SessionActionsMenu } from "./session-actions"
import { SessionPreview } from "./session-preview"
import { SessionUrls, pickPlayableUrl, toSessionUrls } from "./session-urls"

/**
 * One capture run as a media card: a hover-to-preview player over the session's
 * HLS playlist, its live metadata, and every URL it publishes. The card leads
 * with the preview — hovering plays a muted snippet of the underlying stream
 * before the card is ever opened.
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
  const [previewing, setPreviewing] = useState(false)
  const duration = useLiveDurationSeconds(session.started_at, session.ended_at)
  const live = isLive(session.status)
  const remuxing = session.status === "remuxing" || session.status === "finalizing"
  const urls = toSessionUrls(session.session_urls)
  const playable = pickPlayableUrl(urls)
  const link = { to: "/sessions/$sessionId" as const, params: { sessionId: String(session.id) } }

  return (
    <article
      className={cn("session-card", live && "session-card-live")}
      data-selected={selected}
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
      onFocusCapture={() => setPreviewing(true)}
      onBlurCapture={() => setPreviewing(false)}
    >
      <div className="session-card-preview">
        <SessionPreview src={playable} active={previewing} loop={!live} />
        <Link className="session-card-play" aria-label={`Open session #${session.id}`} {...link}>
          <IconPlay size={26} />
        </Link>
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
      </div>

      <div className="session-card-body">
        <div className="session-card-head">
          <Checkbox
            aria-label={`Select session #${session.id}`}
            checked={selected}
            onChange={() => onToggle(session.id)}
          />
          <Link className="session-card-id mono tnum" {...link}>
            #{session.id}
          </Link>
          <span className="session-card-spacer" />
          {session.recording === true ? <Tag accent>REC</Tag> : null}
          <SessionActionsMenu session={session} />
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

        {remuxing ? <RemuxProgressBar sessionId={session.id} className="stack stack-sm" /> : null}

        {urls.length > 0 ? (
          <SessionUrls urls={urls} className="session-card-urls" />
        ) : (
          <p className="session-card-none text-dim">No media yet — nothing published for this run.</p>
        )}
      </div>
    </article>
  )
}
