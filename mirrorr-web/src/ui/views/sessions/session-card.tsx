import { useState, type MouseEvent } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import { isLive } from "@/api/domain/filter-grammar"
import { getStatusDescriptor, isStarting } from "@/api/status"
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
import { SessionUrls, pickHtmlPlayerUrl, pickPlayableUrl, toSessionUrls } from "./session-urls"

/**
 * Descendants that own their own click — a card click must not hijack them.
 * `[data-card-ignore]` is the preview player, never a navigation target.
 */
const INTERACTIVE = "a, button, input, label, [role='menu'], [role='menuitem'], [data-card-ignore]"

/**
 * One capture run as a media card: a preview player over the session's HLS
 * playlist, its live metadata, and every URL it publishes. The first frame
 * loads as a thumbnail on scroll-in and hovering previews the stream where a
 * pointer exists; the play button opens the session's player page embedded in
 * the card, and clicking the rest of the card opens the session.
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
  const starting = isStarting(session.status)
  const live = isLive(session.status) && !starting
  const remuxing = session.status === "remuxing" || session.status === "finalizing"
  const urls = toSessionUrls(session.session_urls)
  const playable = pickPlayableUrl(urls)
  const playerUrl = pickHtmlPlayerUrl(urls)
  const link = { to: "/sessions/$sessionId" as const, params: { sessionId: String(session.id) } }

  function openDetail(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(INTERACTIVE) !== null) return
    if (window.getSelection()?.toString() !== "") return
    void navigate(link)
  }

  return (
    <article
      className={cn(
        "session-card flex flex-col border border-line rounded-lg bg-surface-2 overflow-hidden cursor-pointer",
        "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-line-strong hover:shadow-elev-md",
        "data-[selected=true]:border-brand data-[selected=true]:shadow-[0_0_0_1px_var(--accent-dim)]",
      )}
      data-selected={selected}
      onClick={openDetail}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <SessionPreviewPlayer src={playable} htmlUrl={playerUrl} loop={!live} hovering={hovering} loading={starting} loadingLabel={getStatusDescriptor(session.status).label} label={`session #${session.id}`} badge={<StatusChip status={session.status} />}>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 [background-image:linear-gradient(to_top,var(--overlay-scrim),transparent)] pointer-events-none">
          <StatusChip status={session.status} />
          {live ? (
            <span className="text-2xs font-semibold tracking-[0.06em] uppercase text-ink data-[live=true]:text-danger" data-live="true">
              Live
            </span>
          ) : duration !== null ? (
            <span className="tnum text-2xs font-semibold tracking-[0.06em] uppercase text-ink">{formatDuration(duration)}</span>
          ) : null}
        </div>
      </SessionPreviewPlayer>

      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            aria-label={`Select session #${session.id}`}
            checked={selected}
            onChange={() => onToggle(session.id)}
          />
          <Link className="font-semibold text-ink min-w-0 text-truncate" {...link}>
            {sessionTitle(session, names)}
          </Link>
          <span className="shrink-0 mono tnum text-dim">#{session.id}</span>
          <span className="flex-1" />
          <SessionRecordingButton session={session} />
          <SessionStopDeleteButton session={session} />
        </div>

        <div className="session-card-source text-[13px] leading-snug text-ink [overflow-wrap:anywhere]">
          {resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)}
          <span className="text-dim" aria-hidden="true">
            {" → "}
          </span>
          {resolveEntityName(session.engine_name, names.engines, session.engine_id)}
        </div>

        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-dim">
          <span>
            {resolveEntityName(session.profile_name, names.profiles, session.profile_id)}
          </span>
          <span aria-hidden="true">•</span>
          <span>{session.started_at != null ? formatDateTime(session.started_at) : "not started"}</span>
          {__ADMIN__ && session.requester_user_token !== undefined && session.requester_user_token !== "" ? (
            <>
              <span aria-hidden="true">•</span>
              <span className="mono text-truncate" title={session.requester_user_token}>
                {session.requester_user_token}
              </span>
            </>
          ) : null}
        </div>

        {remuxing ? <RemuxProgressBar sessionId={session.id} className="flex flex-col gap-2" /> : null}

        {urls.length > 0 ? (
          <SessionUrls urls={urls} />
        ) : (
          <p className="text-sm text-dim">No media yet — nothing published for this run.</p>
        )}
      </div>
    </article>
  )
}
