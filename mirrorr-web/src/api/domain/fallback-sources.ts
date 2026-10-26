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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value ?? {}))
}

function sameConfig(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
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
