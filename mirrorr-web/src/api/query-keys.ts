/**
 * Query key factories — exact key table from the Data Layer Contract §Query
 * keys & caching. One root namespace per resource so invalidation never
 * scatters (the legacy DROP: 15-file scattered `invalidateQueries`).
 */

export interface ListParams {
  readonly status?: string
  readonly search?: string
  readonly [key: string]: unknown
}

/** Cursor pagination envelope — `getNextPageParam` consumes this shape. */
export interface CursorPage<T> {
  items: T[]
  next_cursor?: number | null
  has_more: boolean
  total?: number | null
}

export const queryKeys = {
  authMe: ["auth", "me"] as const,
  sessions: (params: ListParams = {}) => ["sessions", params] as const,
  session: (id: number | string) => ["session", String(id)] as const,
  autoruns: (params: ListParams = {}) => ["autoruns", params] as const,
  autorun: (id: number | string) => ["autorun", String(id)] as const,
  recordings: (params: ListParams = {}) => ["recordings", params] as const,
  profiles: (params: ListParams = {}) => ["profiles", params] as const,
  profile: (id: number | string) => ["profile", String(id)] as const,
  sources: (params: ListParams = {}) => ["sources", params] as const,
  source: (id: number | string) => ["source", String(id)] as const,
  engines: ["engines"] as const,
  resolvers: ["resolvers"] as const,
  notifications: ["notifications"] as const,
  users: ["users"] as const,
  clients: ["clients"] as const,
  adminResources: (params: ListParams = {}) => ["admin", "resources", params] as const,
  adminResourceAccess: (resourceType: string, id: number | string) =>
    ["admin", "resources", resourceType, String(id), "access"] as const,
  groups: ["admin", "groups"] as const,
} as const

/**
 * Root prefixes for list-wide writes/invalidation — match every
 * `queryKeys.<list>(params)` variant regardless of the params shape views use.
 */
export const queryRoots = {
  sessions: ["sessions"],
  autoruns: ["autoruns"],
  recordings: ["recordings"],
  profiles: ["profiles"],
  sources: ["sources"],
  adminResources: ["admin", "resources"],
} as const

/** staleTime table (contract §Query keys & caching). */
export const staleTimes = {
  authMe: 60_000,
  list: 0,
  detail: 0,
  profileDetail: 30_000,
  lookup: 300_000,
  notifications: 30_000,
  users: 30_000,
  clients: 30_000,
  adminResources: 30_000,
} as const

export const PAGE_SIZE = 50
export const LOOKUP_PAGE_SIZE = 200

/** Cursor continuation: `has_more ? next_cursor : undefined`. */
export function getNextPageParam<T>(last: CursorPage<T> | undefined): number | undefined {
  if (last === undefined || !last.has_more) return undefined
  return last.next_cursor ?? undefined
}

/** Server does not guarantee newest-first — every list sorts id-desc after merge. */
export function sortByIdDesc<T extends { id: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.id - a.id)
}

export function flattenPages<T>(pages: readonly CursorPage<T>[] | undefined): T[] {
  return pages === undefined ? [] : pages.flatMap((page) => page.items)
}

export function mergedSortedByIdDesc<T extends { id: number }>(
  pages: readonly CursorPage<T>[] | undefined,
): T[] {
  return sortByIdDesc(flattenPages(pages))
}

/** Name memo-map — `["engines"]`/`["resolvers"]`/`["profiles"]` → id→name. */
export function buildNameMap<T extends { id: number; name: string }>(
  items: readonly T[] | undefined,
): Map<number, string> {
  const map = new Map<number, string>()
  for (const item of items ?? []) map.set(item.id, item.name)
  return map
}

/**
 * Prefer a present non-null `_name` field; else memo-map; missing id → `#id`
 * (rendered muted by the caller). `id` null → `—`.
 */
export function resolveEntityName(
  direct: string | null | undefined,
  names: Map<number, string> | undefined,
  id: number | null | undefined,
): string {
  if (direct !== null && direct !== undefined && direct !== "") return direct
  if (id === null || id === undefined) return "—"
  return names?.get(id) ?? `#${id}`
}

/** Crawl every cursor page (lookup tables: engines/resolvers, limit=200). */
export async function fetchAllLookupPages<T>(
  fetchPage: (cursor: number | undefined) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const all: T[] = []
  let cursor: number | undefined
  for (;;) {
    const page = await fetchPage(cursor)
    all.push(...page.items)
    if (!page.has_more) break
    cursor = page.next_cursor ?? undefined
    if (cursor === undefined) break
  }
  return all
}
