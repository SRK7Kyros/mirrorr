import type { Resolver, ResolverSource } from "@/api/schemas"
import { canonicalJson, fallbackSourceLabel, summariseConfig, type FallbackSource } from "./fallback-sources"

/**
 * One rung of a chain: a *patch* over the run's own capture, not a kind of thing
 * and not a change to the rung before it.
 *
 * Naming a profile takes that profile whole; naming a resolver swaps where the
 * stream comes from; naming an engine changes what runs it. A rung may name any
 * combination, and whatever it leaves out is inherited from its base — the
 * profile when the rung names one, otherwise the run's own capture. Every rung
 * is read against that same base, so order is only the order they are tried.
 */
export interface FallbackRung {
  readonly profile_id?: number | null
  readonly engine_id?: number | null
  readonly resolver_id?: number | null
  readonly resolver_config?: Record<string, unknown> | null
}

/** The capture a run makes before its chain — what the first rung patches. */
export interface ChainBase {
  readonly engine_id: number
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown> | null
  readonly profile_id?: number | null
  readonly profile_name?: string | null
  readonly retry_mode?: string | null
  readonly retry_config?: Record<string, unknown> | null
}

/** A rung resolved: every field filled in, the way it will actually run. */
export interface ChainCapture {
  readonly engine_id: number
  readonly resolver_id: number
  readonly resolver_config: Record<string, unknown>
  readonly profile_id: number | null
  readonly profile_name: string
  readonly retry_mode: string
  readonly retry_config: Record<string, unknown>
}

export interface ChainProfile {
  readonly id: number
  readonly name: string
  readonly default_engine_id: number
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown> | null
  readonly retry_mode?: string | null
  readonly retry_config?: Record<string, unknown> | null
}

/** The rows a rung is resolved against — the lookup tables every form already holds. */
export interface ChainCatalog {
  readonly profiles: readonly ChainProfile[]
  readonly engines: readonly { readonly id: number; readonly name: string }[]
  readonly resolvers: readonly Resolver[]
  readonly sources?: readonly ResolverSource[]
}

/** A chain row as stored, in either shape: rungs, or the two lists that predate them. */
export interface ChainRow {
  readonly fallback_chain?: readonly FallbackRung[] | null
  readonly fallback_profile_ids?: readonly number[] | null
  readonly fallback_sources?: readonly FallbackSource[] | null
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * A rung with everything it did not name dropped.
 *
 * `null` and a missing key mean the same thing — inherited — and the server
 * stores neither, so a rung read back from the API and one half-filled in a
 * form compare equal once both are normalised.
 */
export function normaliseRung(raw: FallbackRung): FallbackRung {
  const rung: {
    profile_id?: number
    engine_id?: number
    resolver_id?: number
    resolver_config?: Record<string, unknown>
  } = {}
  if (isId(raw.profile_id)) rung.profile_id = raw.profile_id
  if (isId(raw.engine_id)) rung.engine_id = raw.engine_id
  if (isId(raw.resolver_id)) rung.resolver_id = raw.resolver_id
  if (raw.resolver_config !== undefined && raw.resolver_config !== null) {
    rung.resolver_config = raw.resolver_config
  }
  return rung
}

/** Whether a rung names anything to run — the server refuses one that does not. */
export function rungNames(raw: FallbackRung): boolean {
  return Object.keys(normaliseRung(raw)).length > 0
}

/** The two old lists folded into one chain: profile rungs first, the order they ran in. */
export function foldLegacy(
  profileIds: readonly number[] | null | undefined,
  sources: readonly FallbackSource[] | null | undefined,
): FallbackRung[] {
  return [
    ...(profileIds ?? []).map((id) => ({ profile_id: id })),
    ...(sources ?? []).map((source) => ({
      resolver_id: source.resolver_id,
      ...(source.resolver_config == null ? {} : { resolver_config: source.resolver_config }),
    })),
  ]
}

/**
 * A row's chain, in whichever shape it was stored.
 *
 * `[]` means "no fallbacks" and is honoured; only a row that predates rungs
 * (no `fallback_chain` at all) is read through the old pair.
 */
export function chainOf(row: ChainRow): FallbackRung[] {
  if (row.fallback_chain != null) return row.fallback_chain.map(normaliseRung)
  return foldLegacy(row.fallback_profile_ids, row.fallback_sources)
}

/** The run's own capture as a resolved capture — the first link of every chain. */
export function baseCapture(base: ChainBase): ChainCapture {
  return {
    engine_id: base.engine_id,
    resolver_id: base.resolver_id,
    resolver_config: base.resolver_config ?? {},
    profile_id: base.profile_id ?? null,
    profile_name: base.profile_name ?? "",
    retry_mode: base.retry_mode ?? "none",
    retry_config: base.retry_config ?? {},
  }
}

/** A profile's own capture — the base a chain written for that profile patches. */
export function profileBase(profile: ChainProfile): ChainBase {
  return {
    engine_id: profile.default_engine_id,
    resolver_id: profile.resolver_id,
    resolver_config: profile.resolver_config ?? {},
    profile_id: profile.id,
    profile_name: profile.name,
    retry_mode: profile.retry_mode ?? "none",
    retry_config: profile.retry_config ?? {},
  }
}

/**
 * Identity of a capture — the same stream, through the same engine.
 *
 * Mirrors the server's `source_key`, including its sorted keys, so the client
 * and the server never disagree about which two rungs are the same capture.
 */
export function captureKey(capture: {
  readonly engine_id: number
  readonly resolver_id: number
  readonly resolver_config?: unknown
}): string {
  return `${capture.engine_id}:${capture.resolver_id}:${canonicalJson(capture.resolver_config)}`
}

/** Why one rung cannot run. */
export type RungFailure = "profile-missing" | "engine-missing" | "resolver-missing"

export type RungStep =
  | { readonly ok: true; readonly capture: ChainCapture }
  | { readonly ok: false; readonly kind: RungFailure }

/**
 * One rung as the capture it stands for, inheriting what it does not name.
 *
 * `own` is the run's own capture, and every rung is patched over it rather than
 * over the rung before, so a rung means exactly the capture it describes however
 * many rungs precede it. A config is carried over only while the resolver is
 * still the run's own, because a config belongs to the resolver it configures.
 */
export function resolveRung(raw: FallbackRung, own: ChainCapture, catalog: ChainCatalog): RungStep {
  const rung = normaliseRung(raw)
  const profile =
    rung.profile_id === undefined
      ? null
      : (catalog.profiles.find((entry) => entry.id === rung.profile_id) ?? null)
  if (rung.profile_id !== undefined && profile === null) {
    return { ok: false, kind: "profile-missing" }
  }

  const engine_id = rung.engine_id ?? profile?.default_engine_id ?? own.engine_id
  const resolver_id = rung.resolver_id ?? profile?.resolver_id ?? own.resolver_id

  let resolver_config: Record<string, unknown>
  if (rung.resolver_config !== undefined) {
    resolver_config = { ...rung.resolver_config }
  } else if (profile !== null) {
    resolver_config = { ...(profile.resolver_config ?? {}) }
  } else if (resolver_id !== own.resolver_id) {
    resolver_config = {}
  } else {
    resolver_config = { ...own.resolver_config }
  }

  if (!catalog.engines.some((entry) => entry.id === engine_id)) {
    return { ok: false, kind: "engine-missing" }
  }
  if (!catalog.resolvers.some((entry) => entry.id === resolver_id)) {
    return { ok: false, kind: "resolver-missing" }
  }

  // A profile rung is also that profile's retry policy; a rung that names no
  // profile keeps the run's own, which is what makes it a *source* swap.
  return {
    ok: true,
    capture: {
      engine_id,
      resolver_id,
      resolver_config,
      profile_id: rung.profile_id ?? null,
      profile_name: profile?.name ?? "",
      retry_mode: profile?.retry_mode ?? own.retry_mode,
      retry_config: profile === null ? { ...own.retry_config } : { ...(profile.retry_config ?? {}) },
    },
  }
}

export type ChainProblemKind = RungFailure | "empty" | "primary" | "duplicate"

/** A chain the server would refuse: a rung it cannot build, or one that cannot advance. */
export interface ChainProblem {
  /** Position of the offending rung, zero-based. */
  readonly index: number
  readonly kind: ChainProblemKind
  /** For a duplicate, the earlier rung it repeats; `-1` is the run's own capture. */
  readonly first?: number
}

export interface ChainStep {
  readonly rung: FallbackRung
  /** `null` when the rung could not be resolved at all. */
  readonly capture: ChainCapture | null
  /** This rung's own problem — a later problem does not hide it. */
  readonly problem: ChainProblem | null
}

export interface ResolvedChain {
  readonly steps: readonly ChainStep[]
  /** The captures that stand, in order — what the run will actually try. */
  readonly captures: readonly ChainCapture[]
  /** The first problem, as a sentence-free description; `null` when the chain runs. */
  readonly problem: ChainProblem | null
}

/**
 * A chain resolved the way the server resolves it.
 *
 * A rung that cannot be built, that repeats an earlier capture, or that repeats
 * the run's own is marked but does not stop the walk — the editor shows every
 * problem at once instead of only the first one it hits.
 */
export function resolveChain(
  rungs: readonly FallbackRung[],
  base: ChainBase,
  catalog: ChainCatalog,
): ResolvedChain {
  const own = baseCapture(base)
  const seen = new Map<string, number>([[captureKey(own), -1]])
  const steps: ChainStep[] = []
  const captures: ChainCapture[] = []
  let first: ChainProblem | null = null

  rungs.forEach((raw, index) => {
    const rung = normaliseRung(raw)
    if (!rungNames(rung)) {
      const problem: ChainProblem = { index, kind: "empty" }
      steps.push({ rung, capture: null, problem })
      first ??= problem
      return
    }
    const step = resolveRung(rung, own, catalog)
    if (!step.ok) {
      const problem: ChainProblem = { index, kind: step.kind }
      steps.push({ rung, capture: null, problem })
      first ??= problem
      return
    }
    const seenAt = seen.get(captureKey(step.capture))
    if (seenAt !== undefined) {
      const problem: ChainProblem =
        seenAt < 0 ? { index, kind: "primary" } : { index, kind: "duplicate", first: seenAt }
      steps.push({ rung, capture: step.capture, problem })
      first ??= problem
      return
    }
    seen.set(captureKey(step.capture), index)
    captures.push(step.capture)
    steps.push({ rung, capture: step.capture, problem: null })
  })

  return { steps, captures, problem: first }
}

/**
 * A chain with the rungs that can never advance taken out.
 *
 * When the capture before the chain moves — a different profile, a different
 * own source — a rung that was a real change can become a repeat of it. Those
 * rungs are removed rather than left to block the save, which is the same move
 * the server makes for a chain it inherited.
 */
export function pruneChain(
  rungs: readonly FallbackRung[],
  base: ChainBase,
  catalog: ChainCatalog,
): FallbackRung[] {
  let current = [...rungs]
  for (let pass = 0; pass < rungs.length; pass += 1) {
    const resolved = resolveChain(current, base, catalog)
    if (resolved.problem === null) return current
    const kept = resolved.steps
      .filter(
        (step) =>
          step.problem === null ||
          (step.problem.kind !== "primary" &&
            step.problem.kind !== "duplicate" &&
            step.problem.kind !== "empty"),
      )
      .map((step) => step.rung)
    if (kept.length === current.length) return current
    current = kept
  }
  return current
}

/** Whether two chains are the same rungs, in order — so a no-op prune keeps identity. */
export function sameChain(a: readonly FallbackRung[], b: readonly FallbackRung[]): boolean {
  return (
    a.length === b.length &&
    a.every((rung, index) => canonicalJson(normaliseRung(rung)) === canonicalJson(normaliseRung(b[index])))
  )
}

/* ── naming ───────────────────────────────────────────────────────── */
/** How to spell an id for a reader. */
export interface ChainNaming {
  readonly engine: (id: number) => string
  readonly resolver: (id: number) => string
  readonly profile: (id: number) => string
  readonly sources?: readonly ResolverSource[]
}

/** Naming from the lookup maps every list already holds. */
export function mapNaming(
  maps: {
    readonly engines: ReadonlyMap<number, string>
    readonly resolvers: ReadonlyMap<number, string>
    readonly profiles: ReadonlyMap<number, string>
  },
  sources: readonly ResolverSource[] = [],
): ChainNaming {
  return {
    engine: (id) => maps.engines.get(id) ?? `Engine ${id}`,
    resolver: (id) => maps.resolvers.get(id) ?? `Resolver ${id}`,
    profile: (id) => maps.profiles.get(id) ?? `Profile ${id}`,
    sources,
  }
}

/** Naming from the rows a form resolved against. */
export function catalogNaming(catalog: ChainCatalog): ChainNaming {
  return mapNaming(
    {
      engines: new Map(catalog.engines.map((entry) => [entry.id, entry.name])),
      resolvers: new Map(catalog.resolvers.map((entry) => [entry.id, entry.name])),
      profiles: new Map(catalog.profiles.map((entry) => [entry.id, entry.name])),
    },
    catalog.sources ?? [],
  )
}

/** A source as it is shown: the saved source it matches, else the resolver and its config. */
export function sourceLabel(
  resolverId: number,
  config: Record<string, unknown> | null | undefined,
  naming: ChainNaming,
): string {
  return fallbackSourceLabel(
    { resolver_id: resolverId, resolver_config: config ?? {} },
    naming.resolver,
    naming.sources ?? [],
  )
}

/** What a rung *changes* — the profile it names, its source, its engine. */
export function rungLabel(raw: FallbackRung, naming: ChainNaming): string {
  const rung = normaliseRung(raw)
  const parts: string[] = []
  if (rung.profile_id != null) parts.push(naming.profile(rung.profile_id))
  if (rung.resolver_id != null) {
    parts.push(sourceLabel(rung.resolver_id, rung.resolver_config, naming))
  } else if (rung.resolver_config != null) {
    const config = summariseConfig(rung.resolver_config)
    if (config !== "") parts.push(config)
  }
  if (rung.engine_id != null) parts.push(naming.engine(rung.engine_id))
  return parts.length === 0 ? "Nothing" : parts.join(" · ")
}

/**
 * What a resolved capture will *run* — the profile when it takes one, the
 * source, and the engine only when it is not the run's own.
 */
export function captureLabel(
  capture: ChainCapture,
  base: ChainBase,
  naming: ChainNaming,
): string {
  const source = sourceLabel(capture.resolver_id, capture.resolver_config, naming)
  const head =
    capture.profile_id === null
      ? source
      : `${capture.profile_name === "" ? naming.profile(capture.profile_id) : capture.profile_name} · ${source}`
  if (capture.engine_id === base.engine_id) return head
  return `${head} · ${naming.engine(capture.engine_id)}`
}

/** A whole chain as one line, for a title attribute: `A → B → C`. */
export function chainTitle(rungs: readonly FallbackRung[], naming: ChainNaming): string {
  return rungs.map((rung) => rungLabel(rung, naming)).join(" → ")
}

/** A session's plan entry — a resolved capture, or a shape an older build stored. */
export function planLabel(
  entry: unknown,
  base: ChainBase,
  naming: ChainNaming,
): string {
  if (entry === null || entry === undefined) return captureLabel(baseCapture(base), base, naming)
  if (typeof entry === "number") return naming.profile(entry)
  if (typeof entry !== "object") return "—"
  const spec = entry as Record<string, unknown>
  const resolverId = typeof spec.resolver_id === "number" ? spec.resolver_id : base.resolver_id
  const config =
    typeof spec.resolver_config === "object" && spec.resolver_config !== null
      ? (spec.resolver_config as Record<string, unknown>)
      : {}
  const profileId = typeof spec.profile_id === "number" ? spec.profile_id : null
  const profileName = typeof spec.profile_name === "string" ? spec.profile_name : ""
  const engineId = typeof spec.engine_id === "number" ? spec.engine_id : base.engine_id
  const retryConfig =
    typeof spec.retry_config === "object" && spec.retry_config !== null
      ? (spec.retry_config as Record<string, unknown>)
      : (base.retry_config ?? {})
  return captureLabel(
    {
      engine_id: engineId,
      resolver_id: resolverId,
      resolver_config: config,
      profile_id: profileId,
      profile_name: profileName,
      retry_mode: typeof spec.retry_mode === "string" ? spec.retry_mode : (base.retry_mode ?? "none"),
      retry_config: retryConfig,
    },
    base,
    naming,
  )
}

/**
 * Why a chain cannot be saved, if it cannot — said to a reader, naming the rung
 * they have to change.
 */
export function chainProblemSentence(
  problem: ChainProblem,
  subject: "run" | "profile" = "run",
): string {
  const rung = `Fallback ${problem.index + 1}`
  switch (problem.kind) {
    case "primary":
      return `${rung} is the ${subject}’s own source — change what it names.`
    case "duplicate":
      return `${rung} repeats fallback ${(problem.first ?? 0) + 1} — remove one of them.`
    case "empty":
      return `${rung} names nothing to run — name a profile, an engine or a source.`
    case "profile-missing":
      return `${rung} names a profile that is no longer here.`
    case "engine-missing":
      return `${rung} names an engine that is no longer here.`
    case "resolver-missing":
      return `${rung} names a resolver that is no longer here.`
    default:
      return `${rung} cannot be run.`
  }
}
