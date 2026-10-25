import type { ResolverSource } from "@/api/schemas"

/** One rung of a chain: a resolver and the config to run it with. */
export interface FallbackSource {
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown> | null
}

/** A session's attempt order: a profile id, an inline source, or the run's own capture. */
export type CapturePlanEntry = number | Record<string, unknown> | null

function sameConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

/** Identity of a rung — the same resolver with a different config is a different source. */
export function sourceKey(entry: FallbackSource): string {
  return `${entry.resolver_id}:${JSON.stringify(entry.resolver_config ?? {})}`
}

function summariseConfig(config: Record<string, unknown>): string {
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
