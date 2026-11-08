import { Link } from "@tanstack/react-router"
import type { NameMaps } from "@/api"
import type { RunStateView } from "@/api/domain/run-state"
import type { Session } from "@/api/schemas"
import { buttonClass, MediaFill, Panel, PanelBody, PanelFoot, PanelHead } from "@/ui/components"
import { blockedState, sourcePanelMode, type FileEvidence } from "./session-detail-model"
import { directMediaUrl, plateFor, sessionChain } from "./session-media"
import { SessionPlayer } from "./session-player"
import { SessionPlayerFrame } from "./session-preview-player"
import { SessionRecordingButton } from "./session-recording-button"
import { SessionStarting } from "./session-starting"
import type { AttemptView } from "./session-timeline"
import {
  SessionUrls,
  pickHtmlPlayerUrl,
  pickPlayableUrl,
  toSessionUrls,
  type SessionUrl,
} from "./session-urls"

function DirectMedia({ src, label }: { readonly src: string; readonly label: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-md bg-sunken">
      <video className="h-full w-full" src={src} controls preload="metadata" aria-label={label} />
    </div>
  )
}

/**
 * Whether the source panel draws a 16:9 box — the starting gate, the player,
 * the embedded `player.html`, or a direct media element. When it does not, the
 * panel is a compact band and has no height to balance against the rail.
 */
export function sourceFillsBox(run: RunStateView, urls: readonly SessionUrl[]): boolean {
  return (
    run.state === "starting" ||
    pickPlayableUrl(urls) !== null ||
    pickHtmlPlayerUrl(urls) !== null ||
    directMediaUrl(urls) !== null
  )
}

/**
 * The `Stream` / `Recording` panel — one block whose content is decided by the
 * derived state, never by whichever field happens to be missing (SDR-05):
 * a live run gets the player or its starting gate, a finished run gets the file
 * it published, and a run with no file gets no panel at all.
 *
 * The gate wins over any published URL: an `initializing` run can already carry
 * a playlist URL, and mounting hls.js against a playlist the engine has not
 * written the first frame of yet is what the starting affordance prevents. The
 * reason and its fix sit beside the gate rather than replacing it.
 */
export function SessionSourcePanel({
  session,
  names,
  run,
  evidence,
  attempts,
  title,
  durationSeconds,
}: {
  readonly session: Session
  readonly names: NameMaps
  readonly run: RunStateView
  readonly evidence: FileEvidence
  readonly attempts: readonly AttemptView[]
  readonly title: string
  readonly durationSeconds: number | null
}) {
  const urls = toSessionUrls(session.session_urls)
  const playable = pickPlayableUrl(urls)
  const html = pickHtmlPlayerUrl(urls)
  const direct = directMediaUrl(urls)
  const live = run.panels.sources
  const mode = sourcePanelMode(run, evidence)
  const blocked = live ? blockedState(run, urls, attempts) : null
  const plate = plateFor(session, run, durationSeconds, sessionChain(session, names))
  const playerShown = playable !== null || html !== null || direct !== null
  const plateCarriesReason = live && !playerShown && run.state !== "starting"

  if (mode === "none") return null

  const media = (() => {
    if (run.state === "starting") {
      return <SessionStarting label={run.label} className="aspect-video w-full rounded-md" />
    }
    if (playable !== null) {
      return (
        <SessionPlayer
          src={playable}
          label={`${title} recording`}
          className="overflow-hidden rounded-md"
        />
      )
    }
    if (html !== null) {
      return (
        <SessionPlayerFrame
          url={html}
          label={`${title} recording`}
          className="overflow-hidden rounded-md"
        />
      )
    }
    if (direct !== null) {
      return <DirectMedia src={direct} label={`${title} recording`} />
    }
    if (live) {
      return (
        <MediaFill
          fill="plate"
          compact
          tone="warning"
          label="No source to show"
          fields={[
            blocked?.reason ?? "Nothing is publishing a stream yet",
            sessionChain(session, names),
            "Waiting on the engine",
          ]}
        />
      )
    }
    return (
      <MediaFill
        fill="plate"
        compact
        tone={plate.tone}
        label={plate.label}
        fields={plate.fields}
        className="rounded-md"
      />
    )
  })()

  return (
    <Panel>
      <PanelHead
        title={live ? "Stream" : "Recording"}
        actions={
          live ? null : (
            <Link to="/recordings" className={buttonClass({ variant: "ghost", size: "sm" })}>
              All recordings
            </Link>
          )
        }
      />
      <PanelBody>
        <div className="flex flex-col gap-4">
          {media}
          {blocked !== null ? (
            <p className="text-base text-ink-muted">
              {plateCarriesReason ? null : (
                <span className="font-semibold text-ink">{blocked.reason} </span>
              )}
              {blocked.fix}
            </p>
          ) : null}
          {urls.length > 0 ? <SessionUrls urls={urls} /> : null}
        </div>
      </PanelBody>
      {live ? (
        <PanelFoot className="justify-start">
          <SessionRecordingButton session={session} size="md" />
        </PanelFoot>
      ) : null}
    </Panel>
  )
}
