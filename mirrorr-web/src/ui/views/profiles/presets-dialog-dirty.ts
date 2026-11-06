import type { AccessTarget } from "@/api/domain/access-plan"
import { chainOf, sameChain, type FallbackRung } from "@/api/domain/fallback-chain"
import { canonicalJson } from "@/api/domain/fallback-sources"
import type { Profile, ResolverSource } from "@/api/schemas"

/**
 * What the preset editor would throw away.
 *
 * The dialog used to have no model of "typed but unsaved": the scrim, Escape
 * and Cancel all called `onClose`, so a half-built profile — including a
 * fallback chain the user had carefully staged — disappeared without a word
 * (`PRE-02`, `FLW-07`). This module is the whole of that model, kept free of
 * React so the matrix can be read and tested on its own.
 *
 * A value counts as a change only when it differs from what the dialog opened
 * with. Derived values do not count twice: `mode`/`pickedSourceId` are a way of
 * filling the resolver in, not data of their own, so switching to "use a saved
 * source" and back is not a change, while what that switch copied in is.
 */

export type PresetKind = "profile" | "source"

/** Where the profile's resolver config comes from — exactly one of the two. */
export type ResolverMode = "resolver" | "source"

/** Which form a change belongs to; `access` exists only on creation. */
export type DraftForm = PresetKind | "access"

export interface PresetProfileDraft {
  readonly name: string
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Readonly<Record<string, unknown>>
  readonly retryMode: string
  readonly retryConfig: Readonly<Record<string, unknown>>
  readonly chain: readonly FallbackRung[]
}

export interface PresetSourceDraft {
  readonly name: string
  readonly resolverId: string
  readonly resolverConfig: Readonly<Record<string, unknown>>
}

export interface PresetDraftState {
  readonly profile: PresetProfileDraft
  readonly source: PresetSourceDraft
  readonly access: AccessTarget
}

export interface PresetChange {
  readonly form: DraftForm
  /** How the change is spoken aloud in "Discard changes?": "the fallback chain". */
  readonly label: string
}

export const EMPTY_DRAFT: PresetDraftState = {
  profile: {
    name: "",
    engineId: "",
    resolverId: "",
    resolverConfig: {},
    retryMode: "",
    retryConfig: {},
    chain: [],
  },
  source: { name: "", resolverId: "", resolverConfig: {} },
  access: {},
}

/** The state a dialog opened on this target starts in — reset and baseline alike. */
export function draftFrom(profile: Profile | null, source: ResolverSource | null): PresetDraftState {
  return {
    profile: {
      name: profile?.name ?? "",
      engineId: profile === null ? "" : String(profile.default_engine_id),
      resolverId: profile === null ? "" : String(profile.resolver_id),
      resolverConfig: profile?.resolver_config ?? {},
      retryMode: profile?.retry_mode ?? "",
      retryConfig: profile?.retry_config ?? {},
      chain: chainOf(profile ?? {}),
    },
    source: {
      name: source?.name ?? "",
      resolverId: source === null ? "" : String(source.resolver_id),
      resolverConfig: source?.resolver_config ?? {},
    },
    access: {},
  }
}

/**
 * Every field that differs from the baseline, in the order the form reads —
 * one entry per thing, not per keystroke.
 */
export function changedFields(
  initial: PresetDraftState,
  current: PresetDraftState,
): readonly PresetChange[] {
  const changes: PresetChange[] = []
  const profile = (label: string) => changes.push({ form: "profile", label })
  const source = (label: string) => changes.push({ form: "source", label })

  if (current.profile.name !== initial.profile.name) profile("the name")
  if (current.profile.engineId !== initial.profile.engineId) profile("the engine")
  if (current.profile.resolverId !== initial.profile.resolverId) profile("the resolver")
  if (json(current.profile.resolverConfig) !== json(initial.profile.resolverConfig)) {
    profile("the resolver config")
  }
  if (current.profile.retryMode !== initial.profile.retryMode) profile("the retry mode")
  if (json(current.profile.retryConfig) !== json(initial.profile.retryConfig)) {
    profile("the retry config")
  }
  // A staged rung is work: it is part of what closing would throw away.
  if (!sameChain(current.profile.chain, initial.profile.chain)) profile("the fallback chain")

  if (current.source.name !== initial.source.name) source("the name")
  if (current.source.resolverId !== initial.source.resolverId) source("the resolver")
  if (json(current.source.resolverConfig) !== json(initial.source.resolverConfig)) {
    source("the resolver config")
  }

  if (json(current.access) !== json(initial.access)) {
    changes.push({ form: "access", label: "the access grants" })
  }

  return dedupe(changes)
}

/** "the name, the retry mode and the fallback chain" — said once per thing. */
export function unsavedList(changes: readonly PresetChange[]): string {
  const labels = changes.map((change) => change.label)
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

export type DiscardIntent = "close" | "switch"

/** The body of "Discard changes?" — names what is unsaved and what happens to it. */
export function discardSentence(
  changes: readonly PresetChange[],
  subject: PresetKind,
  intent: DiscardIntent,
): string {
  const list = unsavedList(changes)
  const loss = changes.length > 1 ? "them" : "it"
  return intent === "switch"
    ? `Unsaved: ${list}. Switching to the other form discards ${loss}.`
    : `Unsaved: ${list}. Closing this ${subject} discards ${loss}.`
}

function json(value: unknown): string {
  return canonicalJson(value)
}

/** Two forms can name the same idea ("the resolver"); say it once. */
function dedupe(changes: readonly PresetChange[]): readonly PresetChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    if (seen.has(change.label)) return false
    seen.add(change.label)
    return true
  })
}
