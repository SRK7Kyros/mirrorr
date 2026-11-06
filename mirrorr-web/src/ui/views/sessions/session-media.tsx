import type { ReactNode } from "react"
import type { NameMaps } from "@/api"
import type { RunStateView } from "@/api/domain/run-state"
import { resolveEntityName } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import { formatBytes, formatDateTime, formatDuration } from "@/api/time"
import { MediaFill } from "@/ui/components"
import { toCaptureView, type CaptureView } from "./session-timeline"
import { SessionPreviewPlayer } from "./session-preview-player"
import {
  pickHtmlPlayerUrl,
  pickPlayableUrl,
  toSessionUrls,
  type SessionUrl,
} from "./session-urls"

/**
 * The `media` slot of a Sessions card — one 16:9 box that is **always filled**,
 * from the closed set `frame` · `cover` · `plate` (plan §2.2a). The fill is a
 * property of the run's state, never of whether a value happens to be missing:
 *
 * - `frame` — the run is live (or waiting for its engine), so the box holds the
 *   real preview player and its `▶`. A finished run whose file is published only
 *   as an HLS playlist reuses the same player paused on its first frame, because
 *   a bare `<video>` cannot paint an `.m3u8`.
 * - `cover` — a finished run that published a direct media file (`.mp4`, …), so
 *   the box paints that file's own first frame with a muted
 *   `preload="metadata"` `<video>`. No ffmpeg pass, no new route, no cache.
 * - `plate` — nothing to play. The plate is built from the record itself (why it
 *   failed, how many attempts, how long it ran, whether the file was kept), so
 *   the uniform 16:9 box never costs a card a row of blank pixels.
 *
 * `remuxing`/`finalizing` is not a fourth fill: it pins `recording_progress` to
 * the bottom edge of the plate, so finalising adds no height.
 */

/** Statuses whose media is the live frame, gate and player included. */
const FRAME_STATUSES: ReadonlySet<string> = new Set([
  "initializing",
  "stream_pending",
  "active",
  "recording",
])

const DIRECT_MEDIA = /\.(mp4|m4v|webm|mkv|mov)$/i

export type PlateTone = "neutral" | "warning" | "danger" | "success"

/** `resolver → engine`, resolved through the name maps when the row omits one. */
export function sessionChain(session: Session, names: NameMaps): string {
  const resolver = resolveEntityName(session.resolver_name, names.resolvers, session.resolver_id)
  const engine = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  return `${resolver === "" ? "—" : resolver} → ${engine === "" ? "—" : engine}`
}

/** The newest capture, which is the one that decides what a failed run says. */
export function latestCapture(session: Session): CaptureView | null {
  const captures = (session.captures ?? []).map((raw, index) => toCaptureView(raw, index))
  if (captures.length === 0) return null
  return captures.reduce((newest, capture) => (capture.index > newest.index ? capture : newest))
}

/** Bytes the run actually wrote, summed across its captures; `null` when unrecorded. */
export function capturedBytes(session: Session): number | null {
  const captures = session.captures ?? []
  if (captures.length === 0) return null
  let total = 0
  let seen = false
  for (const raw of captures) {
    const bytes = toCaptureView(raw, 0).bytes
    if (bytes === null) continue
    total += bytes
    seen = true
  }
  return seen ? total : null
}

/**
 * How many times this run has been attempted. The record's own list wins; a run
 * that predates it still knows its retry counter.
 */
export function attemptCount(session: Session): number {
  const attempts = session.attempts?.length ?? 0
  if (attempts > 0) return attempts
  return Math.max(1, (session.retry_attempts ?? 0) + 1)
}

/** A published direct media file — the only thing a `<video>` can cover from. */
export function directMediaUrl(urls: readonly SessionUrl[]): string | null {
  return urls.find((entry) => DIRECT_MEDIA.test(entry.url.split(/[?#]/)[0] ?? ""))?.url ?? null
}

const durationLine = (seconds: number | null, verb: string): string =>
  seconds === null ? "No duration recorded" : `${formatDuration(seconds)} ${verb}`

const sizeLine = (bytes: number | null, verb: string): string =>
  bytes === null ? "Size not recorded" : `${formatBytes(bytes)} ${verb}`

/** Plate copy for a run whose file cannot be played from the card. */
export function plateFor(
  session: Session,
  run: RunStateView,
  durationSeconds: number | null,
  chain: string,
): { readonly label: string; readonly tone: PlateTone; readonly fields: readonly ReactNode[] } {
  const bytes = capturedBytes(session)
  const capture = latestCapture(session)

  if (session.status === "terminating") {
    return {
      label: "Stopped — file kept",
      tone: "neutral",
      fields: [
        durationLine(durationSeconds, "recorded"),
        sizeLine(bytes, "written"),
        session.ended_at == null
          ? "Stopping now — the engine is winding down"
          : `stopped ${formatDateTime(session.ended_at)}`,
      ],
    }
  }

  if (run.state === "starting") {
    return {
      label: "Waiting for the stream",
      tone: "neutral",
      fields: [
        durationLine(durationSeconds, "elapsed"),
        chain,
        `attempt ${attemptCount(session)} · waiting on the engine process`,
      ],
    }
  }

  if (run.state === "failed") {
    const attempts = attemptCount(session)
    return {
      label: "No file — capture failed",
      tone: "danger",
      fields: [
        <span className="line-clamp-2">
          {capture?.reason ?? "The record states no reason for this failure"}
        </span>,
        `${attempts} attempt${attempts === 1 ? "" : "s"} used${
          (session.retry_attempts ?? 0) > 0 ? ` · ${session.retry_attempts} retries` : ""
        }`,
        bytes === null ? "Nothing was written to disk" : `${formatBytes(bytes)} captured`,
      ],
    }
  }

  if (run.state === "finalising") {
    return {
      label: "Finalising — file kept",
      tone: "warning",
      fields: [
        durationLine(durationSeconds, "recorded"),
        sizeLine(bytes, "on disk"),
        "Not playable until the remux finishes",
      ],
    }
  }

  if (run.state === "completed") {
    return {
      label: "Recorded — not published",
      tone: "success",
      fields: [
        durationLine(durationSeconds, "recorded"),
        sizeLine(bytes, "on disk"),
        session.ended_at == null
          ? "No end time on the record"
          : `ended ${formatDateTime(session.ended_at)}`,
      ],
    }
  }

  if (run.state === "scheduled") {
    return {
      label: "Not started",
      tone: "neutral",
      fields: ["No stream yet", chain, "Nothing published for this run"],
    }
  }

  return {
    label: "State unknown",
    tone: "neutral",
    fields: [chain, durationLine(durationSeconds, "on the record"), "Open the session for its history"],
  }
}

/**
 * `recording_progress` as the pinned line. It is read from the record, so the
 * line survives a reload with no websocket attached; the percentage is never
 * invented — with no sample the pin says what it is doing, not how far along.
 */
export function remuxPin(session: Session, run: RunStateView): ReactNode {
  if (run.state !== "finalising") return null
  const label = session.status === "remuxing" ? "Remuxing" : "Finalising"
  const progress = session.recording_progress
  const percent = typeof progress?.percent === "number" ? Math.round(progress.percent) : null
  const eta = typeof progress?.eta_seconds === "number" ? progress.eta_seconds : null
  const speed = typeof progress?.speed === "number" ? progress.speed : null
  const parts = [
    percent === null ? label : `${label} ${percent}%`,
    eta === null ? null : `ETA ${formatDuration(Math.round(eta))}`,
    speed === null ? null : `${speed.toFixed(2)}×`,
  ].filter((part): part is string => part !== null)
  return <span className="flex-1 truncate">{parts.join(" · ")}</span>
}

export interface SessionMediaProps {
  readonly session: Session
  readonly names: NameMaps
  readonly run: RunStateView
  /** Elapsed while live, total once the run has ended. */
  readonly durationSeconds: number | null
  /** A pointer is over the card — the preview plays muted instead of holding a poster. */
  readonly hovering: boolean
  /** Resolved title, reused as the media box's accessible label. */
  readonly title: string
}

export function SessionMedia({
  session,
  names,
  run,
  durationSeconds,
  hovering,
  title,
}: SessionMediaProps) {
  const urls = toSessionUrls(session.session_urls)
  const label = `Session ${title}`
  const pin = remuxPin(session, run)

  if (FRAME_STATUSES.has(session.status)) {
    return (
      <MediaFill fill="frame" label={`Live preview of ${label}`}>
        <SessionPreviewPlayer
          src={pickPlayableUrl(urls)}
          htmlUrl={pickHtmlPlayerUrl(urls)}
          loop={false}
          hovering={hovering}
          loading={session.status === "initializing" || session.status === "stream_pending"}
          loadingLabel={run.label}
          label={label}
        />
      </MediaFill>
    )
  }

  const playable = pickPlayableUrl(urls)
  const direct = directMediaUrl(urls)

  if (run.state === "completed") {
    if (direct !== null) {
      return <MediaFill fill="cover" src={direct} label={`First frame of ${label}`} />
    }
    if (playable !== null) {
      return (
        <MediaFill fill="frame" label={`Published file for ${label}`}>
          <SessionPreviewPlayer
            src={playable}
            htmlUrl={pickHtmlPlayerUrl(urls)}
            loop={false}
            hovering={hovering}
            label={label}
          />
        </MediaFill>
      )
    }
  }

  const plate = plateFor(session, run, durationSeconds, sessionChain(session, names))
  return (
    <MediaFill fill="plate" label={plate.label} tone={plate.tone} fields={plate.fields} pin={pin} />
  )
}
