import type { NameMaps } from "@/api"
import type { RunStateView } from "@/api/domain/run-state"
import { mapNaming, planLabel } from "@/api/domain/fallback-chain"
import { resolveEntityName } from "@/api/query-keys"
import type { Session } from "@/api/schemas"
import {
  attemptCount,
  capturedBytes,
  directMediaUrl,
  latestCapture,
} from "./session-media"
import { pickHtmlPlayerUrl, pickPlayableUrl, type SessionUrl } from "./session-urls"
import type { AttemptView } from "./session-timeline"

/**
 * The session detail page's derived facts — the parts of SCR-04 that are
 * decisions rather than markup.
 *
 * `deriveRunState()` already decides *what state the run is in*; this module
 * answers the four questions the page used to answer in four unrelated places:
 * is the route param even an id, is there a file to open, what is the run
 * blocked on, and what does a failure say plus what fixes it. Keeping them pure
 * is what lets the page's unit tests assert them without rendering a query.
 */

/**
 * `/sessions/abc` is a bad link, not a deleted run (SDR-06). The old page
 * fetched the string, got a 404 and told the user their run had been deleted —
 * a claim about the account made from a typo.
 */
export function parseSessionId(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The one URL `Open recording` should open: the console's own viewer when the
 * run published one, else the media file itself.
 */
export function servedFileUrl(urls: readonly SessionUrl[]): string | null {
  return pickHtmlPlayerUrl(urls) ?? directMediaUrl(urls) ?? pickPlayableUrl(urls)
}

export interface FileEvidence {
  /** A URL a browser can open — the header's `Open recording` needs this. */
  readonly published: boolean
  /** A file is on disk for this run, published or not. */
  readonly kept: boolean
  /** Bytes the captures wrote, `null` when the record counted none. */
  readonly bytes: number | null
}

/**
 * What the record proves about the file. `deriveRunState().panels.recording`
 * asks the same question from the status alone, which cannot tell a failed run
 * that wrote nothing from one that kept a partial capture — the detail page
 * shows a Recording panel only when there is something in it.
 */
export function fileEvidence(
  session: Session,
  urls: readonly SessionUrl[],
): FileEvidence {
  const bytes = capturedBytes(session)
  const kept =
    urls.length > 0 ||
    session.status === "completed" ||
    session.status === "remuxing" ||
    session.status === "finalizing" ||
    (bytes ?? 0) > 0
  return { published: urls.length > 0, kept, bytes }
}

/** Which panel the source block renders, if any — plan §2.3 "conditioned panels". */
export function sourcePanelMode(
  run: RunStateView,
  evidence: FileEvidence,
): "stream" | "recording" | "none" {
  if (run.panels.sources) return "stream"
  return evidence.kept ? "recording" : "none"
}

export interface BlockedState {
  /** The fact the record states, named as the operator's config key. */
  readonly reason: string
  /** What resolves it. A reason without a fix is a riddle, not a status. */
  readonly fix: string
}

/**
 * Why a live run has no player. The old page printed "Live URLs not configured"
 * as a grey sentence on a finished run and an unverifiable elapsed clock on a
 * live one; the state decides which of the two, and each carries its fix.
 */
export function blockedState(
  run: RunStateView,
  urls: readonly SessionUrl[],
  attempts: readonly AttemptView[],
): BlockedState | null {
  if (run.panels.sources && urls.length === 0) {
    return {
      reason: "No stream to play — the engine has not published a web_url.",
      fix: "An operator sets web_url in the deployment config. Until then the run keeps capturing with no player and no link to share.",
    }
  }
  if (run.panels.sources && attempts.length === 0) {
    return {
      reason: "No attempt recorded yet.",
      fix: "The supervisor starts attempt 1 once the resolver settles a source. Nothing is stuck while the elapsed clock keeps moving.",
    }
  }
  return null
}

/**
 * The failure's own words. The capture record is the newest statement about
 * why a source failed; an attempt's reason is the fallback for records written
 * before captures existed. A user stop is not a failure reason.
 */
export function failureReason(
  session: Session,
  attempts: readonly AttemptView[],
): string {
  const capture = latestCapture(session)
  if (capture !== null && capture.reason !== null && capture.reason !== "") {
    return capture.reason
  }
  const newest = [...attempts]
    .sort((a, b) => b.index - a.index)
    .find((attempt) => attempt.reason !== null && attempt.reason !== "stopped")
  return newest?.reason ?? "The record states no reason for this failure."
}

/**
 * The fix, stated honestly: there is no retry endpoint on this install, so a
 * failed run cannot be re-run from this page. Saying "Retry" and doing nothing
 * would be worse than saying that.
 */
export const FAILED_FIX =
  "A failed run is final — this install has no retry endpoint. Check the source and retry settings in Config, then start a new session from the same profile."

/** One sentence: what the run is doing now, in the derived state's words. */
export function stateSentence(run: RunStateView): string {
  switch (run.state) {
    case "scheduled":
      return "Scheduled — nothing has started yet."
    case "starting":
      return "Starting — the resolver is checking sources; the engine has not attached yet."
    case "live":
      return "Live — the engine is attached and the capture is running."
    case "recording":
      return "Recording — the engine is capturing this stream to a file."
    case "finalising":
      return "Finalising — the capture is being remuxed into a playable file."
    case "completed":
      return "Finished — the capture ended and the record was closed."
    case "failed":
      return "Failed — the run ended before it wrote a usable file."
    case "retired":
      return "Retired — this run's window has passed."
    default:
      return "The record's status is not one this console knows."
  }
}

/** What the duration number below the sentence measures. */
export function durationLabel(run: RunStateView): string {
  if (run.hero === "elapsed") return run.state === "starting" ? "Waiting" : "Elapsed"
  if (run.hero === "duration") return "Duration"
  return "Clock"
}

/**
 * Everything the attempt list needs to say when it has nothing to list. A
 * terminal run must never claim to be waiting for a supervisor that has already
 * finished (SDR-01).
 */
export function timelineEmptyText(run: RunStateView): string {
  if (run.panels.sources) return "Attempt 1 has not started yet."
  if (run.state === "failed") {
    return "No attempt was recorded — the failure reason beside the status is all the record holds."
  }
  if (run.state === "completed") return "No attempt was recorded for this run."
  return "No attempt was recorded."
}

/** Attempts the record holds, for the Facts panel. */
export function attemptsUsed(session: Session): number {
  return attemptCount(session)
}

/** The header subtitle, and nothing else: `profile → engine` (SDR-04). */
export function headerSubtitle(session: Session, names: NameMaps): string {
  const profile = resolveEntityName(session.profile_name, names.profiles, session.profile_id)
  const engine = resolveEntityName(session.engine_name, names.engines, session.engine_id)
  return `${profile === "" ? "No profile" : profile} → ${engine === "" ? "no engine" : engine}`
}

/**
 * The sources the run will still fall back to. Only a live run owes any: the
 * plan's first entry is the source running now, and a finished run's leftovers
 * are history, not a promise.
 */
export function pendingFallbacks(
  session: Session,
  names: NameMaps,
  captureCount: number,
  live: boolean,
): readonly string[] {
  if (!live) return []
  const plan = session.capture_plan ?? []
  const base = {
    engine_id: session.engine_id,
    resolver_id: session.resolver_id,
    resolver_config: session.resolver_config ?? {},
    profile_id: session.profile_id ?? null,
    profile_name: session.profile_name ?? "",
  }
  const naming = mapNaming({
    engines: names.engines ?? new Map<number, string>(),
    resolvers: names.resolvers ?? new Map<number, string>(),
    profiles: names.profiles ?? new Map<number, string>(),
  })
  return plan
    .slice(Math.max(captureCount, 1))
    .map((entry) => planLabel(entry, base, naming))
}

