import type { AccessTarget } from "@/api/domain/access-plan"
import { chainOf, sameChain, type FallbackRung } from "@/api/domain/fallback-chain"
import { canonicalJson } from "@/api/domain/fallback-sources"
import type { Autorun } from "@/api/schemas"
import { naiveUtcToDatetimeLocal } from "@/api/time"

/**
 * What the autorun dialog would throw away.
 *
 * Every close path in this dialog used to be a bare `onClose`: the scrim, Escape
 * and Cancel all dropped a half-typed window — a name, an auto-slug, a staged
 * fallback chain — without a word (`P6` exit, "no dialog silently discards
 * work"). This module is the whole of that model, kept free of React so the
 * matrix can be read and tested on its own, exactly as `presets-dialog-dirty`
 * does for the preset editor.
 *
 * A value counts as a change only when it differs from what the dialog opened
 * with. Derived values do not count twice: `mode` is a way of filling the
 * capture in, not data of its own, so flipping between "a profile" and
 * "engine + resolver" is only a change once it would alter what is saved.
 */

/** The picker's own choice; `auto` defers to the catalogs (see `resolveMode`). */
export type AutorunModeChoice = "auto" | "profile" | "custom"

/** What the dialog actually renders once `auto` has been resolved. */
export type AutorunMode = Exclude<AutorunModeChoice, "auto">

export interface AutorunDraft {
  readonly friendly: string
  readonly slug: string
  readonly mode: AutorunModeChoice
  readonly profileId: string
  readonly chain: readonly FallbackRung[]
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Readonly<Record<string, unknown>>
  /** `datetime-local` wall time, which is the user's zone — the server gets UTC. */
  readonly startLocal: string
  readonly endLocal: string
  readonly recording: boolean
  readonly access: AccessTarget
}

export interface AutorunChange {
  /** How the change is spoken aloud in "Discard this autorun?": "the name". */
  readonly label: string
}

export const EMPTY_AUTORUN_DRAFT: AutorunDraft = {
  friendly: "",
  slug: "",
  mode: "auto",
  profileId: "",
  chain: [],
  engineId: "",
  resolverId: "",
  resolverConfig: {},
  startLocal: "",
  endLocal: "",
  recording: true,
  access: {},
}

/** The state the dialog opens in — reset target and dirty baseline alike. */
export function draftFrom(autorun?: Autorun): AutorunDraft {
  if (autorun === undefined) return EMPTY_AUTORUN_DRAFT
  const fromProfile = autorun.profile_id !== null && autorun.profile_id !== undefined
  return {
    friendly: autorun.user_friendly_name,
    slug: autorun.snake_case_name,
    mode: fromProfile ? "profile" : "custom",
    profileId: fromProfile ? String(autorun.profile_id) : "",
    chain: chainOf(autorun),
    engineId: String(autorun.engine_id),
    resolverId: String(autorun.resolver_id),
    resolverConfig: autorun.resolver_config ?? {},
    startLocal: naiveUtcToDatetimeLocal(autorun.start_time),
    endLocal: naiveUtcToDatetimeLocal(autorun.end_time),
    recording: autorun.recording !== false,
    access: {},
  }
}

/**
 * Which half of the form a create dialog shows.
 *
 * It used to be frozen at open time, so a dialog opened before the profile list
 * answered stayed on "engine + resolver" for good (`AUT-07`). An untouched
 * picker now follows the catalogs: it shows the profile form while that list is
 * loading or failed — a failure must not read as "you have no profiles" — and
 * only falls back to "engine + resolver" once the server has actually answered
 * with none. Typing an engine and resolver stops it following.
 */
export type ProfileCatalogState = "loading" | "ready" | "empty" | "failed"

export function resolveMode(
  choice: AutorunModeChoice,
  profileCatalog: ProfileCatalogState,
  hasCustomBase: boolean,
): AutorunMode {
  if (choice !== "auto") return choice
  if (hasCustomBase) return "custom"
  return profileCatalog === "empty" ? "custom" : "profile"
}

function hasCustomBase(draft: AutorunDraft): boolean {
  return draft.engineId !== "" && draft.resolverId !== ""
}

/**
 * Every field that differs from the baseline, in the order the form reads —
 * one entry per thing, not per keystroke.
 */
export function changedFields(
  initial: AutorunDraft,
  current: AutorunDraft,
): readonly AutorunChange[] {
  const changes: AutorunChange[] = []
  const add = (label: string) => changes.push({ label })

  if (current.friendly !== initial.friendly) add("the name")
  if (current.slug !== initial.slug) add("the slug")
  if (current.mode !== initial.mode && modeChangesTheSave(current)) add("the start source")
  if (current.profileId !== initial.profileId) add("the profile")
  // A staged rung is work: it is part of what closing would throw away.
  if (!sameChain(current.chain, initial.chain)) add("the fallback chain")
  if (current.engineId !== initial.engineId) add("the engine")
  if (current.resolverId !== initial.resolverId) add("the resolver")
  if (canonicalJson(current.resolverConfig) !== canonicalJson(initial.resolverConfig)) {
    add("the resolver config")
  }
  if (current.startLocal !== initial.startLocal) add("the start time")
  if (current.endLocal !== initial.endLocal) add("the end time")
  if (current.recording !== initial.recording) add("the recording setting")
  if (canonicalJson(current.access) !== canonicalJson(initial.access)) add("the access grants")

  return dedupe(changes)
}

/** A different half of the form only counts once that half can actually run. */
function modeChangesTheSave(draft: AutorunDraft): boolean {
  return draft.mode === "profile" ? draft.profileId !== "" : hasCustomBase(draft)
}

/** "the name, the start time and the fallback chain" — said once per thing. */
export function unsavedList(changes: readonly AutorunChange[]): string {
  const labels = changes.map((change) => change.label)
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

/** The body of "Discard this autorun?" — names what is unsaved and what happens to it. */
export function discardSentence(changes: readonly AutorunChange[]): string {
  const loss = changes.length > 1 ? "them" : "it"
  return `Unsaved: ${unsavedList(changes)}. Closing this autorun discards ${loss}.`
}

/** Two entries can name the same idea; say it once. */
function dedupe(changes: readonly AutorunChange[]): readonly AutorunChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    if (seen.has(change.label)) return false
    seen.add(change.label)
    return true
  })
}
