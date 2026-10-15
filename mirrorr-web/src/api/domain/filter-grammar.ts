export const FILTER_TOKENS = ["scheduled", "live", "spent", "all"] as const
export type FilterToken = (typeof FILTER_TOKENS)[number]

export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
])
export const SPENT_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"])

export const DEFAULT_FILTER: readonly FilterToken[] = ["all"]

export function parseFilterTokens(raw: string | null | undefined): {
  tokens: FilterToken[]
  dropped: string[]
} {
  const tokens: FilterToken[] = []
  const dropped: string[] = []
  for (const part of (raw ?? "").split("+").map((piece) => piece.trim())) {
    if (part === "") continue
    if ((FILTER_TOKENS as readonly string[]).includes(part)) {
      const token = part as FilterToken
      if (!tokens.includes(token)) tokens.push(token)
    } else {
      dropped.push(part)
    }
  }
  return { tokens, dropped }
}

export function parseFilter(raw: string | null | undefined): FilterToken[] {
  if (raw === null || raw === undefined) return [...DEFAULT_FILTER]
  const { tokens } = parseFilterTokens(raw)
  return tokens.length === 0 ? ["all"] : tokens
}

export function matchesFilter(status: string, tokens: readonly FilterToken[]): boolean {
  if (tokens.includes("all")) return true
  if (tokens.includes("scheduled") && status === "scheduled") return true
  if (tokens.includes("live") && LIVE_STATUSES.has(status)) return true
  if (tokens.includes("spent") && SPENT_STATUSES.has(status)) return true
  return false
}

/** Non-`all` filters auto-exhaust pagination (client-side scope rule). */
export function shouldAutoExhaust(tokens: readonly FilterToken[]): boolean {
  return !tokens.includes("all")
}

export function isSpent(status: string): boolean {
  return SPENT_STATUSES.has(status)
}

export function isLive(status: string): boolean {
  return LIVE_STATUSES.has(status)
}
