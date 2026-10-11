/** Small presentation-only formatters. Time/byte/number formatting lives in
 * `@/api/time`; this file adds identity and label helpers the UI needs. */

/** 1–2 letter monogram from a display name or username. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** `"1 session"` / `"3 sessions"`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** `"Showing 12"` — the honest count for cursor lists (no fake totals). */
export function showingLabel(count: number): string {
  return `Showing ${count}`
}

/** Human label from a snake_case token: `"enable-recording"` → `"Enable recording"`. */
export function humanize(token: string): string {
  const spaced = token.replace(/[_-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Truncate a string to `max` chars with an ellipsis. */
export function truncate(value: string, max: number): string {
  if (max <= 0) return ""
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
