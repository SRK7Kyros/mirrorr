import type { ImportItem, ApplyBody } from "@/views/shared/api"

/**
 * Deterministic apply-body encoding for V10 (functional contract):
 * the bundle sent is the EDITED one, never the raw file.
 * - `profile_missing` → Bind to existing: entry's embedded `profile` is
 *   rewritten to `{"name": "<chosen installed profile name>"}` (matched by
 *   name at apply — no new profile). Use inline config: the `profile` key is
 *   removed and the entry keeps its own engine/resolver/config (self-contained).
 * - `engine_override` → Keep autorun engine: entry unchanged. Use profile
 *   engine: the entry's inline engine fields are removed so it inherits the
 *   profile's engine.
 * - `plugin_map` maps origin_hash → installed engine/resolver id and is used
 *   EXCLUSIVELY for not_installed / hash_mismatch.
 * - `removed_profiles` / `removed_autoruns` carry ONLY names of items the
 *   user explicitly excluded via the include toggle (exclusion is expressed
 *   solely through these arrays; the entry itself stays in the bundle).
 * - `name_conflict` needs no client edit (server auto-renames; UI previews).
 */

export const BUNDLE_ITEM_LIMIT = 500

export interface PluginMapEntry {
  readonly type: "engine" | "resolver"
  readonly id: number
}

export type ProfileResolution = { readonly mode: "bind"; readonly profileName: string } | { readonly mode: "inline" }
export type EngineResolution = { readonly mode: "keep" } | { readonly mode: "profile" }

export interface ItemResolution {
  readonly included: boolean
  readonly plugin?: PluginMapEntry
  readonly pluginHash?: string
  readonly profile?: ProfileResolution
  readonly engine?: EngineResolution
}

export function isSupportedVersion(bundle: unknown): boolean {
  if (typeof bundle !== "object" || bundle === null) return false
  return (bundle as { version?: unknown }).version === 1
}

export function countBundleItems(bundle: unknown): number {
  if (typeof bundle !== "object" || bundle === null) return 0
  const shape = bundle as { profiles?: unknown; autoruns?: unknown }
  const profiles = Array.isArray(shape.profiles) ? shape.profiles.length : 0
  const autoruns = Array.isArray(shape.autoruns) ? shape.autoruns.length : 0
  return profiles + autoruns
}

const ENGINE_INLINE_FIELDS = [
  "engine",
  "engine_id",
  "resolver",
  "resolver_id",
  "resolver_config",
  "retry_mode",
  "retry_config",
] as const

type LooseEntry = Record<string, unknown>

function entriesOf(bundle: unknown, key: "profiles" | "autoruns"): LooseEntry[] {
  if (typeof bundle !== "object" || bundle === null) return []
  const list = (bundle as Record<string, unknown>)[key]
  return Array.isArray(list) ? (list as LooseEntry[]) : []
}

function entryName(item: ImportItem, entry: LooseEntry | undefined): string {
  const fallback = item.name
  if (entry === undefined) return fallback
  const candidates = [entry.name, entry.snake_case_name, entry.user_friendly_name]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") return candidate
  }
  return fallback
}

function findEntry(bundle: unknown, item: ImportItem): LooseEntry | undefined {
  const key = item.kind === "autorun" ? "autoruns" : "profiles"
  const list = entriesOf(bundle, key)
  return (
    list.find((entry) => entry.name === item.name) ??
    list.find((entry) => entry.snake_case_name === item.name) ??
    list.find((entry) => entry.user_friendly_name === item.name)
  )
}

export function buildApplyBody(
  bundle: unknown,
  items: readonly ImportItem[],
  resolutions: Readonly<Record<string, ItemResolution>>,
): ApplyBody {
  const edited: Record<string, unknown> =
    typeof bundle === "object" && bundle !== null
      ? (JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>)
      : {}
  const plugin_map: Record<string, PluginMapEntry> = {}
  const removed_profiles: string[] = []
  const removed_autoruns: string[] = []

  for (const item of items) {
    const resolution = resolutions[item.name] ?? { included: true }
    const name = entryName(item, findEntry(edited, item))
    if (!resolution.included) {
      if (item.kind === "autorun") removed_autoruns.push(name)
      else removed_profiles.push(name)
      continue
    }

  const hasHashIssue = item.issues.some(
    (issue: ImportItem["issues"][number]) =>
      issue.type === "not_installed" || issue.type === "hash_mismatch",
  )
    if (hasHashIssue && resolution.plugin !== undefined && resolution.pluginHash !== undefined) {
      plugin_map[resolution.pluginHash] = resolution.plugin
    }

    const entry = findEntry(edited, item)
    if (entry === undefined) continue

    if (resolution.profile !== undefined) {
      if (resolution.profile.mode === "bind") {
        entry.profile = { name: resolution.profile.profileName }
      } else {
        delete entry.profile
      }
    }

    if (resolution.engine !== undefined && resolution.engine.mode === "profile") {
      for (const field of ENGINE_INLINE_FIELDS) delete entry[field]
    }
  }

  const body: ApplyBody = {
    bundle: edited,
    plugin_map,
    ...(removed_profiles.length > 0 ? { removed_profiles } : {}),
    ...(removed_autoruns.length > 0 ? { removed_autoruns } : {}),
  }
  return body
}

export type IssueKind =
  | "not_installed"
  | "hash_mismatch"
  | "name_conflict"
  | "profile_missing"
  | "engine_override"
  | "other"

export function issueKind(issue: { type: string }): IssueKind {
  switch (issue.type) {
    case "not_installed":
    case "hash_mismatch":
    case "name_conflict":
    case "profile_missing":
    case "engine_override":
      return issue.type
    default:
      return "other"
  }
}

export type ItemBadge = "ready" | "skip" | "needs-mapping" | "conflict"

export function itemBadge(item: ImportItem): ItemBadge {
  if (item.status === "skip" || item.status === "already_imported") return "skip"
  const kinds = item.issues.map(issueKind)
  if (kinds.includes("name_conflict")) return "conflict"
  if (
    kinds.includes("not_installed") ||
    kinds.includes("hash_mismatch") ||
    kinds.includes("profile_missing") ||
    kinds.includes("engine_override")
  ) {
    return "needs-mapping"
  }
  return "ready"
}

export const BADGE_LABELS: Record<ItemBadge, string> = {
  ready: "Ready",
  skip: "Skip — already imported",
  "needs-mapping": "Needs mapping",
  conflict: "Conflict",
}

export function suggestedRename(item: ImportItem): string | null {
  for (const issue of item.issues) {
    if (issue.type !== "name_conflict") continue
    const next = issue.suggested ?? issue.new_name ?? issue.suggestion
    if (typeof next === "string" && next !== "") return next
  }
  return null
}

export function issueOriginHash(issue: Record<string, unknown>): string | null {
  const hash = issue.origin_hash ?? issue.hash ?? issue.content_hash
  return typeof hash === "string" && hash !== "" ? hash : null
}

export function issuePluginType(issue: Record<string, unknown>): "engine" | "resolver" {
  const kind = issue.plugin_type ?? issue.kind ?? issue.target
  return kind === "resolver" ? "resolver" : "engine"
}
