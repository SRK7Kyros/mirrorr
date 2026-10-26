import type { ResolverSource } from "@/api/schemas"

/** One rung of a chain: a resolver and the config to run it with. */
export interface FallbackSource {
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown> | null
}

/** A session's attempt order: a profile id, an inline source, or the run's own capture. */
export type CapturePlanEntry = number | Record<string, unknown> | null

/**
 * A config written the way the server writes it (`sort_keys=True`).
 *
 * Two forms of the same config are the same source, and the server decides that
 * with sorted keys — so a rung read back from the API and one built from a form
 * field must compare equal even when their keys were filled in a different order.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value ?? {}))
}

function sameConfig(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** Identity of a rung — the same resolver with a different config is a different source. */
export function sourceKey(entry: FallbackSource): string {
  return `${entry.resolver_id}:${canonicalJson(entry.resolver_config)}`
}

/** A chain the server would refuse: it repeats the run's own source, or a rung of itself. */
export interface ChainProblem {
  /** Position of the offending rung, zero-based. */
  readonly index: number
  readonly kind: "primary" | "duplicate"
  /** For a duplicate, the earlier rung it repeats. */
  readonly first?: number
}

/**
 * Why a chain cannot be saved, if it cannot: the server refuses a rung that
 * repeats the run's own source (it could never advance) or an earlier rung.
 */
export function chainProblem(
  chain: readonly FallbackSource[],
  primary?: FallbackSource | null,
): ChainProblem | null {
  const primaryKey = primary === null || primary === undefined ? null : sourceKey(primary)
  const seen = new Map<string, number>()
  for (let index = 0; index < chain.length; index += 1) {
    const key = sourceKey(chain[index])
    if (key === primaryKey) return { index, kind: "primary" }
    const first = seen.get(key)
    if (first !== undefined) return { index, kind: "duplicate", first }
    seen.set(key, index)
  }
  return null
}

/** The same problem, said to a reader, naming the rung they have to change. */
export function chainProblemSentence(
  problem: ChainProblem,
  subject: "run" | "profile" = "run",
): string {
  const rung = `Fallback ${problem.index + 1}`
  if (problem.kind === "primary") {
    return `${rung} is the ${subject}’s own source — remove it or change that source.`
  }
  return `${rung} repeats fallback ${(problem.first ?? 0) + 1} — remove one of them.`
}

export function summariseConfig(config: Record<string, unknown>): string {
  return Object.entries(config)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value)
      return `${key}=${text.length > 18 ? `${text.slice(0, 17)}…` : text}`
    })
    .join(" · ")
}

/**
 * The name a source is shown by: the saved source it matches, else the resolver
 * plus a short summary of the config that makes it different from the rest.
 */
export function fallbackSourceLabel(
  entry: FallbackSource,
  resolverName: (id: number) => string,
  sources: readonly ResolverSource[] = [],
): string {
  const saved = sources.find(
    (source) =>
      source.resolver_id === entry.resolver_id &&
      sameConfig(source.resolver_config, entry.resolver_config),
  )
  if (saved !== undefined) return saved.name
  const config = summariseConfig(entry.resolver_config ?? {})
  const resolver = resolverName(entry.resolver_id)
  return config === "" ? resolver : `${resolver} · ${config}`
}

/**
 * A rung of a session's plan, named for a reader: a profile by its name, a
 * source by its resolver, and the run's own capture as a dash.
 */
export function planEntryLabel(
  entry: CapturePlanEntry,
  resolveProfile: (id: number) => string,
  resolveResolver: (id: number) => string,
): string {
  if (entry === null) return "—"
  if (typeof entry === "number") return resolveProfile(entry)
  const resolverId = entry.resolver_id
  if (typeof resolverId !== "number") return "—"
  const config = entry.resolver_config
  return fallbackSourceLabel(
    {
      resolver_id: resolverId,
      resolver_config:
        typeof config === "object" && config !== null
          ? (config as Record<string, unknown>)
          : {},
    },
    resolveResolver,
  )
}

/**
 * The chain a run inherits when it names a profile: that profile's own sources
 * run after the capture, and the picker shows none of them.
 */
export function inheritedChainHint(
  sources: readonly FallbackSource[] | null | undefined,
): string | null {
  const count = sources?.length ?? 0
  if (count === 0) return null
  return `Also inherits ${count} source ${count === 1 ? "fallback" : "fallbacks"} from the profile.`
}
