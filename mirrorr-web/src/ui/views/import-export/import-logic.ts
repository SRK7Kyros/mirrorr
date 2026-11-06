import { itemBadge, issueKind, suggestedRename, type ImportItem, type ItemResolution } from "@/api"

/**
 * Preview rules for the import wizard, kept out of the view so the acceptance
 * criteria (defaults, counts, the N-of-M summary) can be asserted without a
 * browser. The component only renders what these functions decide.
 */

/** How a name collision is settled before apply. */
export type CollisionMode = "replace" | "skip" | "keep"

/** An item resolution plus the collision choice the apply body does not carry. */
export interface ImportResolution extends ItemResolution {
  readonly collision?: CollisionMode
}

export type ImportResolutions = Readonly<Record<string, ImportResolution>>

export const itemKey = (item: ImportItem): string => `${item.kind}:${item.name}`

export interface KindCounts {
  readonly profiles: number
  readonly autoruns: number
}

export function countByKind(items: readonly ImportItem[]): KindCounts {
  let profiles = 0
  let autoruns = 0
  for (const item of items) {
    if (item.kind === "autorun") autoruns += 1
    else profiles += 1
  }
  return { profiles, autoruns }
}

export interface Collision {
  /** The installed item the bundle would clash with, when the server named it. */
  readonly existingId: number | null
  /** Name the server allocates for "keep both". */
  readonly keepName: string
}

export function collisionOf(item: ImportItem): Collision | null {
  for (const issue of item.issues) {
    if (issueKind(issue) !== "name_conflict") continue
    const existingId = typeof issue.existing_id === "number" ? issue.existing_id : null
    return { existingId, keepName: suggestedRename(item) ?? item.name }
  }
  return null
}

/**
 * Only items the server can create without a decision start selected. A name
 * collision and an identical copy are both decisions, so both default to
 * excluded — the badge is information, not an opt-in.
 */
export function defaultIncluded(item: ImportItem): boolean {
  const badge = itemBadge(item)
  return badge === "ready" || badge === "needs-mapping"
}

export function initialResolutions(items: readonly ImportItem[]): Record<string, ImportResolution> {
  const next: Record<string, ImportResolution> = {}
  for (const item of items) {
    const included = defaultIncluded(item)
    next[itemKey(item)] = collisionOf(item) === null
      ? { included }
      : { included, collision: included ? "keep" : "skip" }
  }
  return next
}

export function resolutionOf(
  resolutions: ImportResolutions,
  item: ImportItem,
): ImportResolution | undefined {
  return resolutions[itemKey(item)]
}

/** A checkbox is authoritative; changing it resets the collision choice. */
export function withIncluded(resolution: ImportResolution, included: boolean): ImportResolution {
  return { ...resolution, included }
}

export function withCollision(resolution: ImportResolution, collision: CollisionMode): ImportResolution {
  return { ...resolution, collision, included: collision !== "skip" }
}

export function selectedCount(items: readonly ImportItem[], resolutions: ImportResolutions): number {
  let count = 0
  for (const item of items) {
    if (resolutions[itemKey(item)]?.included === true) count += 1
  }
  return count
}

export function selectionLabel(items: readonly ImportItem[], resolutions: ImportResolutions): string {
  return `${selectedCount(items, resolutions)} of ${items.length} selected`
}

export function selectedCounts(items: readonly ImportItem[], resolutions: ImportResolutions): KindCounts {
  return countByKind(items.filter((item) => resolutions[itemKey(item)]?.included === true))
}

export function replaceTargets(items: readonly ImportItem[], resolutions: ImportResolutions): ImportItem[] {
  return items.filter((item) => {
    const resolution = resolutions[itemKey(item)]
    return resolution?.included === true && resolution.collision === "replace"
  })
}

/** Whether the row still asks the user for a plugin or inheritance choice. */
export function needsResolution(item: ImportItem): boolean {
  return item.issues.some((issue) => {
    const kind = issueKind(issue)
    return (
      kind === "not_installed" ||
      kind === "hash_mismatch" ||
      kind === "profile_missing" ||
      kind === "engine_override"
    )
  })
}

/**
 * Why the apply button is off. `null` means it may fire. The message is the
 * button's visible reason, so a disabled control never has to explain itself
 * through a tooltip alone.
 */
export function applyBlockReason(
  items: readonly ImportItem[],
  resolutions: ImportResolutions,
): string | null {
  if (items.length === 0) return "This bundle contains no items to import."
  if (selectedCount(items, resolutions) === 0) return "Select at least one item to import."
  return null
}

export interface CreatedNames {
  readonly profiles: readonly string[]
  readonly autoruns: readonly string[]
}

/**
 * Names the server will store for the selected items. Undo matches on these
 * because the apply response's id list is not part of the client's schema; a
 * collision either keeps its name (replace) or takes the suggested rename.
 */
export function createdNames(items: readonly ImportItem[], resolutions: ImportResolutions): CreatedNames {
  const profiles: string[] = []
  const autoruns: string[] = []
  for (const item of items) {
    const resolution = resolutions[itemKey(item)]
    if (resolution?.included !== true) continue
    if (item.kind === "autorun") {
      autoruns.push(item.name)
      continue
    }
    const keepName = collisionOf(item)?.keepName
    const renamed = resolution.collision === "replace" ? undefined : keepName
    profiles.push(renamed ?? item.name)
  }
  return { profiles, autoruns }
}

/** Apply the collision decisions that the body cannot express: delete first. */
export function collisionDeletions(
  items: readonly ImportItem[],
  resolutions: ImportResolutions,
): readonly { readonly kind: "profile" | "autorun"; readonly id: number }[] {
  const targets: { kind: "profile" | "autorun"; id: number }[] = []
  for (const item of replaceTargets(items, resolutions)) {
    const existingId = collisionOf(item)?.existingId
    if (existingId === null || existingId === undefined) continue
    targets.push({ kind: item.kind === "autorun" ? "autorun" : "profile", id: existingId })
  }
  return targets
}

interface BundleShape {
  readonly profiles?: readonly unknown[]
  readonly autoruns?: readonly unknown[]
}

/**
 * One copy of each profile. An autorun export carries its linked profile, so
 * selecting both would otherwise put the same profile in the bundle twice and
 * validate would report it conflicting with itself.
 */
export function dedupeProfiles(bundle: unknown): unknown {
  if (typeof bundle !== "object" || bundle === null) return bundle
  const shape = bundle as BundleShape
  const profiles = shape.profiles ?? []
  const seen = new Set<string>()
  const unique = profiles.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return true
    const name = (entry as { name?: unknown }).name
    if (typeof name !== "string") return true
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
  return { ...(bundle as Record<string, unknown>), profiles: unique, autoruns: shape.autoruns ?? [] }
}
