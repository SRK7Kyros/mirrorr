/**
 * V5's `?filter=` grammar — the `+`-joined token set of spec L284-L287.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L284-L287: `?filter=scheduled+live` is the
 *   default; tokens `{scheduled, live, spent, all}`; **live** =
 *   `active|recording|terminating|remuxing|finalizing`; **spent** =
 *   `completed|failed`; `all` ≡ `scheduled+live+spent`; unknown tokens are
 *   dropped; an empty result means `all`; spent is a separate chip and rows
 *   render at 60% opacity.
 * - `docs/general-client-specification.md` §13.11.1: autoruns are one-shot,
 *   never re-armed, and spent is hidden by default (client-side only).
 *
 * Filtering is purely client-side over the loaded pages; when the filter is
 * not `all` the view auto-exhausts pagination so the set is complete.
 */

export type AutorunFilterToken = "scheduled" | "live" | "spent" | "all"

export const AUTORUN_FILTER_TOKENS: readonly AutorunFilterToken[] = [
  "scheduled",
  "live",
  "spent",
  "all",
]

/** Canonical order used when serializing a token set back to `+`-joined form. */
const SERIALIZED_ORDER: readonly AutorunFilterToken[] = ["scheduled", "live", "spent"]

export const AUTORUN_FILTER_LABELS: Readonly<Record<AutorunFilterToken, string>> = {
  scheduled: "Scheduled",
  live: "Live",
  spent: "Spent",
  all: "All",
}

export const DEFAULT_AUTORUN_FILTER_TOKENS: readonly AutorunFilterToken[] = ["scheduled", "live"]
export const DEFAULT_AUTORUN_FILTER = "scheduled+live"

/** §5 status families. */
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
])
const SPENT_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"])

export interface AutorunFilter {
  readonly tokens: ReadonlySet<AutorunFilterToken>
  /** The canonical `+`-joined serialization (round-trips through `?filter=`). */
  readonly canonical: string
  /** True when the filter is the grammar's `all` (no client-side hiding). */
  readonly isAll: boolean
}

function isToken(value: string): value is AutorunFilterToken {
  return (AUTORUN_FILTER_TOKENS as readonly string[]).includes(value)
}

function makeFilter(tokens: ReadonlySet<AutorunFilterToken>): AutorunFilter {
  const isAll = tokens.has("all")
  const canonical = isAll
    ? "all"
    : SERIALIZED_ORDER.filter((token) => tokens.has(token)).join("+")
  return { tokens, canonical, isAll }
}

/**
 * Parses a raw `?filter=` value. Absent/blank → the default
 * `scheduled+live`; tokens are trimmed, lowercased and unknown ones dropped;
 * a result of nothing (or the `all` token) → `all`.
 */
export function parseAutorunFilter(raw: string | null | undefined): AutorunFilter {
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return makeFilter(new Set(DEFAULT_AUTORUN_FILTER_TOKENS))
  }

  const tokens = new Set<AutorunFilterToken>()
  for (const part of raw.split("+")) {
    const token = part.trim().toLowerCase()
    if (isToken(token)) tokens.add(token)
  }

  if (tokens.size === 0 || tokens.has("all")) return makeFilter(new Set(["all"]))
  return makeFilter(tokens)
}

/** `scheduled` / `live` / `spent` / `unknown` for a raw status string. */
export function autorunStatusFamily(status: string): "scheduled" | "live" | "spent" | "unknown" {
  if (status === "scheduled") return "scheduled"
  if (LIVE_STATUSES.has(status)) return "live"
  if (SPENT_STATUSES.has(status)) return "spent"
  return "unknown"
}

/** True when the row belongs to the filter's token set (spec L285). */
export function autorunMatchesFilter(status: string, filter: AutorunFilter): boolean {
  if (filter.isAll) return true
  return filter.tokens.has(autorunStatusFamily(status) as AutorunFilterToken)
}

/** True for `completed|failed` — the 60%-opacity spent rows. */
export function isSpentAutorun(status: string): boolean {
  return autorunStatusFamily(status) === "spent"
}

/**
 * The next canonical `?filter=` value after toggling a chip. Selecting `all`
 * replaces the set; toggling the last token off yields `all` (the grammar's
 * empty→all rule).
 */
export function toggleAutorunFilterToken(filter: AutorunFilter, token: AutorunFilterToken): string {
  if (token === "all") return "all"

  const tokens = new Set<AutorunFilterToken>(filter.isAll ? [] : filter.tokens)
  if (tokens.has(token)) tokens.delete(token)
  else tokens.add(token)

  if (tokens.size === 0) return "all"
  return makeFilter(tokens).canonical
}

/**
 * §5/L285: any non-`all` filter auto-exhausts pagination so the filtered set
 * is complete (the `all` filter keeps the normal incremental loading).
 */
export function shouldAutoExhaustAutoruns(filter: AutorunFilter): boolean {
  return !filter.isAll
}
