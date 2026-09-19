/**
 * The query-key table and staleTimes.
 *
 * Contract: `docs/web-frontend-spec.md` L120-L137 (key shapes + staleTime
 * column) and L138 ("filter/search changes reset the query key (new cursor)").
 *
 * Every list key carries its NORMALIZED filter object, so a filter change
 * yields a fresh key and a fresh cursor; equal filters always hash to the same
 * key. The normalized object is frozen and key-sorted, which also makes it
 * stable for React dependency arrays.
 */

/** Scalar values a list filter may carry. */
export type ListFilterValue = string | number | boolean

/** A list's filter/search parameters; blank entries are dropped. */
export type ListFilters = Readonly<Record<string, ListFilterValue | null | undefined>>

/**
 * The staleTime column of the spec's query-key table, in milliseconds.
 *
 * - entity lists are `0` because the WebSocket stream is the delta source;
 * - engine/resolver catalogs are `5min` and fetched all-pages (`limit=200`);
 * - notifications/users/clients and profile details are `30s`;
 * - `auth/me` is `60s`.
 */
export const QUERY_STALE_TIMES_MS = {
  authMe: 60_000,
  sessions: 0,
  session: 0,
  autoruns: 0,
  autorun: 0,
  recordings: 0,
  profiles: 0,
  profile: 30_000,
  engines: 300_000,
  resolvers: 300_000,
  notifications: 30_000,
  users: 30_000,
  clients: 30_000,
} as const

/**
 * Drops `undefined`/`null`/empty-string filters and returns a frozen,
 * key-sorted object. `false` and `0` are kept — they are meaningful filters.
 */
export function normalizeListFilters(
  filters: ListFilters = {},
): Readonly<Record<string, ListFilterValue>> {
  const entries = Object.entries(filters).filter(
    (entry): entry is [string, ListFilterValue] =>
      entry[1] !== undefined && entry[1] !== null && entry[1] !== "",
  )
  // Stable, locale-independent ordering so equal filters hash identically.
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  const normalized: Record<string, ListFilterValue> = {}
  for (const [key, value] of entries) normalized[key] = value
  return Object.freeze(normalized)
}

/** The spec's key table; parameterized lists take their filters here. */
export const queryKeys = {
  authMe: () => ["auth", "me"] as const,
  /** Public bootstrap probe (`GET /auth/status`); used by V1/V2, not in the spec table. */
  authStatus: () => ["auth", "status"] as const,
  sessions: (filters?: ListFilters) => ["sessions", normalizeListFilters(filters)] as const,
  session: (id: number) => ["session", id] as const,
  autoruns: (filters?: ListFilters) => ["autoruns", normalizeListFilters(filters)] as const,
  autorun: (id: number) => ["autorun", id] as const,
  recordings: (filters?: ListFilters) => ["recordings", normalizeListFilters(filters)] as const,
  profiles: (filters?: ListFilters) => ["profiles", normalizeListFilters(filters)] as const,
  profile: (id: number) => ["profile", id] as const,
  engines: () => ["engines"] as const,
  resolvers: () => ["resolvers"] as const,
  notifications: () => ["notifications"] as const,
  users: () => ["users"] as const,
  clients: () => ["clients"] as const,
} as const
