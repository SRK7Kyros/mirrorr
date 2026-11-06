import { summariseConfig } from "@/api/domain/fallback-sources"
import type { Engine, Profile, Resolver } from "@/api/schemas"
import { humanize } from "@/ui/lib/format"

/**
 * What the chosen profile will actually run, before the operator commits
 * (`FLW-01`: the dialog used to take a profile by name only — the engine, the
 * source and the retry policy that decide whether the capture works at all were
 * invisible until after Start).
 *
 * Three lines, in the order that matters: where the stream comes from, what
 * happens when it fails, whether a file is written. A name the catalog cannot
 * resolve renders as `#id` rather than as an empty cell, so the line never
 * silently disappears.
 */
export interface ProfileSummaryProps {
  readonly profile: Profile
  readonly engines: readonly Engine[]
  readonly resolvers: readonly Resolver[]
  /** The dialog's own switch — the summary states what Start will do with it. */
  readonly recording: boolean
}

function nameOf<T extends { readonly id: number; readonly name: string }>(
  catalog: readonly T[],
  id: number,
  given: string | null | undefined,
  noun: string,
): string {
  if (given !== null && given !== undefined && given !== "") return given
  return catalog.find((item) => item.id === id)?.name ?? `${noun} #${id}`
}

/** `"none"` → "No retry"; anything else names the mode and its settings. */
export function retrySummary(profile: Profile): string {
  const mode = (profile.retry_mode ?? "").trim()
  if (mode === "" || mode === "none") return "No retry"
  const config = summariseConfig(profile.retry_config ?? {})
  return config === "" ? humanize(mode) : `${humanize(mode)} — ${config}`
}

export function ProfileSummary({ profile, engines, resolvers, recording }: ProfileSummaryProps) {
  const engine = nameOf(engines, profile.default_engine_id, profile.engine_name, "Engine")
  const resolver = nameOf(resolvers, profile.resolver_id, profile.resolver_name, "Source")

  return (
    <dl
      data-slot="profile-summary"
      aria-label="What this profile will run"
      className="flex flex-col gap-1.5 rounded-sm border border-line-subtle bg-surface-1 py-2.5 px-3"
    >
      <div className={ROW}>
        <dt className={LABEL}>Runs</dt>
        <dd className={VALUE}>
          {resolver}
          <span aria-hidden="true">{" → "}</span>
          {engine}
        </dd>
      </div>
      <div className={ROW}>
        <dt className={LABEL}>Retry</dt>
        <dd className={VALUE}>{retrySummary(profile)}</dd>
      </div>
      <div className={ROW}>
        <dt className={LABEL}>Recording</dt>
        <dd className={VALUE}>
          {recording ? "On — a file is written to disk" : "Off — nothing is saved"}
        </dd>
      </div>
    </dl>
  )
}

const ROW = "flex items-baseline gap-3"
const LABEL = "w-[4.5rem] shrink-0 text-sm text-ink-dim"
const VALUE = "min-w-0 flex-1 text-base text-ink-muted [overflow-wrap:anywhere]"
