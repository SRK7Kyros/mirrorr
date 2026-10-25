import { test as base, expect, type Page, type Route } from "@playwright/test"

/**
 * Route-mocked API for the browser suite.
 *
 * The console boots on `GET /auth/me` and then fetches cursor-paginated lists;
 * a view needs nothing else to render. `installApi` answers `**\/api/**` from
 * the fixture data below and records every request, so a spec can assert what
 * the UI *sent* as well as what it painted.
 *
 * WebSocket routes are stubbed silent for the same reason: the socket's
 * liveness is irrelevant to rendering, and leaving it real would only produce
 * reconnect noise and a "Live updates paused" banner.
 *
 * Payload shapes mirror `src/api/schemas`; a mismatch fails Zod parsing, which
 * the client reports as `ApiError(0, "Unexpected server response")`.
 */

/* ── payload builders ─────────────────────────────────────────────── */

export type Row = Record<string, unknown>

export const USER = { id: 1, username: "kyros", role: "admin", display_name: "Kyros" }

export function authResponse(): Row {
  return { user: USER, client: null, access_token: null, refresh_token: null }
}

export interface CursorPage<T> {
  items: T[]
  next_cursor: number | null
  has_more: boolean
  total: number
}

/** The `{items, has_more}` envelope every list endpoint returns. */
export function cursorPage<T>(items: readonly T[]): CursorPage<T> {
  return { items: [...items], next_cursor: null, has_more: false, total: items.length }
}

export function session(overrides: Row = {}): Row {
  return {
    id: 1,
    profile_id: null,
    autorun_id: null,
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    recording: false,
    retry_attempts: 0,
    started_at: null,
    ended_at: null,
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    profile_name: null,
    ...overrides,
  }
}

export function autorun(overrides: Row = {}): Row {
  return {
    id: 1,
    user_friendly_name: "Autorun 1",
    snake_case_name: "autorun-1",
    profile_id: null,
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    start_time: "2026-10-12 09:00:00",
    end_time: "2026-10-12 11:00:00",
    recording: false,
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    profile_name: null,
    next_run_at: null,
    last_run_at: null,
    ...overrides,
  }
}

export function engine(overrides: Row = {}): Row {
  return {
    id: 1,
    name: "Streamlink",
    description: "HLS engine",
    origin: "builtin",
    origin_hash: "abc1234",
    capabilities: { can_stream: true, can_record: false },
    ...overrides,
  }
}

export function resolver(overrides: Row = {}): Row {
  return {
    id: 1,
    name: "Wide IPTV",
    description: "Channel resolver",
    origin: "user",
    origin_hash: "0a1b2c3",
    config_schema: { type: "object" },
    /** The core's own default: a resolver with no catalog is search-only. */
    has_catalog: false,
    ...overrides,
  }
}

export function profile(overrides: Row = {}): Row {
  return {
    id: 1,
    name: "F1 Weekend",
    default_engine_id: 1,
    resolver_id: 1,
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    ...overrides,
  }
}

export function source(overrides: Row = {}): Row {
  return {
    id: 1,
    name: "Sky Sports",
    resolver_id: 1,
    resolver_name: "Wide IPTV",
    resolver_config: { url: "http://sky.example/playlist.m3u8" },
    ...overrides,
  }
}

/* ── the stub ─────────────────────────────────────────────────────── */

export interface ApiCall {
  readonly method: string
  /** Path with the `/api` prefix stripped, e.g. `/autoruns/2`. */
  readonly path: string
  readonly body: unknown
}

export interface ApiData {
  authenticated?: boolean
  /** `POST /auth/login` — reject the credentials to exercise the fallback path. */
  loginFails?: boolean
  sessions?: readonly Row[]
  autoruns?: readonly Row[]
  recordings?: readonly Row[]
  profiles?: readonly Row[]
  sources?: readonly Row[]
  engines?: readonly Row[]
  resolvers?: readonly Row[]
  /** Admin surface: `GET /auth/users`, `/auth/clients`, `/auth/registration-requests` rows. */
  users?: readonly Row[]
  clients?: readonly Row[]
  registrationRequests?: readonly Row[]
  /** `GET /admin/resources` rows (owner-bearing items plus engines/resolvers). */
  resources?: readonly Row[]
  /** `GET /groups` rows — `{id, name, display_name, system, members?}`. */
  groups?: readonly Row[]
  /** VIEW grants keyed `"{type}:{id}"` for the `GET /shares/…` routes. */
  resourceViewers?: Record<string, readonly string[]>
  /** Per-user capability sets keyed `"{type}:{id}"` — overrides `resourceViewers` per user. */
  resourceGrants?: Record<
    string,
    readonly { readonly username: string; readonly capabilities: readonly string[] }[]
  >
  /** Owner usernames keyed `"{type}:{id}"` — additive to the requester owner. */
  ownerUsers?: Record<string, readonly string[]>
  /** Owner-group ids keyed `"{type}:{id}"` — additive to the single user owner. */
  ownerGroups?: Record<string, readonly number[]>
  /** Group capability sets keyed `"{type}:{id}"` — the group analogue of `resourceGrants`. */
  groupGrants?: Record<
    string,
    readonly { readonly group_id: number; readonly capabilities: readonly string[] }[]
  >
  /** `POST /resolvers/{id}/discover` — the catalog the channel browser reads. */
  discovery?: readonly Row[]
  /** Page size the stub slices `discovery` with (default: one page). */
  discoveryPageSize?: number
  /** `POST /import-export/validate` — the staged-item report. */
  validate?: unknown
  /** `POST /import-export/apply` — the applied-import summary. */
  apply?: unknown
  /** `POST /import-export/fetch` — the bundle a URL resolves to. */
  fetchBundle?: unknown
  /** `DELETE /profiles/{id}` cascade counts, e.g. `{flagged: 2}`. */
  profileDeleteCounts?: Record<string, number>
}

export interface ApiStub {
  readonly data: ApiData
  readonly calls: ApiCall[]
  /** Recorded calls whose path contains `fragment`, e.g. `callsTo("/autoruns/")`. */
  callsTo(fragment: string): ApiCall[]
}

function parseBody(raw: string | null): unknown {
  if (raw === null || raw === "") return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function installApi(page: Page, data: ApiData): Promise<ApiStub> {
  const calls: ApiCall[] = []

  /** Ids for rows the stub "creates" — the collection list is the spec's own. */
  let createdIds = 0

  const resourceViewers: Record<string, string[]> = {}
  const explicitGrants: Record<string, { username: string; capabilities: string[] }[]> = {}
  const groups: Row[] = []
  const groupGrants: Record<string, { group_id: number; capabilities: string[] }[]> = {}
  const ownerUsers: Record<string, string[]> = {}
  const ownerGroups: Record<string, number[]> = {}
  let nextGroupId = 0
  // Seeded on the first API call, not here: a spec assigns `api.data.*` before it
  // navigates, so an eager snapshot would miss every seed.
  let seeded = false
  const seed = (): void => {
    if (seeded) return
    seeded = true
    for (const [key, list] of Object.entries(data.resourceViewers ?? {})) resourceViewers[key] = [...list]
    for (const [key, list] of Object.entries(data.resourceGrants ?? {})) {
      explicitGrants[key] = list.map((grant) => ({ username: grant.username, capabilities: [...grant.capabilities] }))
    }
    for (const row of data.groups ?? []) {
      groups.push({ ...row, members: [...((row.members as string[] | undefined) ?? [])] })
    }
    for (const [key, list] of Object.entries(data.groupGrants ?? {})) {
      groupGrants[key] = list.map((grant) => ({ group_id: grant.group_id, capabilities: [...grant.capabilities] }))
    }
    for (const [key, list] of Object.entries(data.ownerUsers ?? {})) ownerUsers[key] = [...list]
    for (const [key, list] of Object.entries(data.ownerGroups ?? {})) ownerGroups[key] = [...list]
    nextGroupId = groups.reduce((max, row) => Math.max(max, Number(row.id)), 0)
  }

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route: Route) => {
    seed()
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname.replace(/^\/api/, "")
    const body = parseBody(request.postData())
    calls.push({ method, path, body })

    const answer = (status: number, json: unknown): Promise<void> =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) })
    const list = (items: readonly Row[] | undefined): Promise<void> => answer(200, cursorPage(items ?? []))

    const groupById = (id: number): Row | undefined => groups.find((row) => row.id === id)
    const groupName = (id: number): string => String(groupById(id)?.name ?? `#${id}`)
    const groupView = (row: Row): Record<string, unknown> => ({
      id: row.id,
      name: row.name,
      display_name: row.display_name ?? "",
      system: row.system ?? false,
      member_count: (row.members as string[] | undefined)?.length ?? 0,
      members: [...((row.members as string[] | undefined) ?? [])],
    })

    const authenticated = data.authenticated ?? true

    if (path === "/auth/me" || path === "/auth/refresh") {
      return authenticated ? answer(200, authResponse()) : answer(401, { detail: "Not authenticated" })
    }
    if (path === "/auth/status") return answer(200, { has_users: true })
    if (path === "/auth/login") {
      return data.loginFails === true ? answer(401, { detail: "Invalid credentials" }) : answer(200, authResponse())
    }
    if (path === "/auth/logout") return answer(200, {})

    if (path === "/auth/users") return answer(200, data.users ?? [])
    if (path === "/auth/clients") return answer(200, data.clients ?? [])
    if (path === "/auth/registration-requests") return answer(200, data.registrationRequests ?? [])

    // A create echoes the row the server would have stored. The list branch
    // below answers ANY method, so without this a `create*()` call would parse
    // a list envelope as one row and warn. A seeded first row is the template:
    // its fields are what makes the echo pass the same schema the list does, so
    // a spec that needs the create to SUCCEED seeds the collection it creates.
    const create = /^\/(autoruns|sessions|profiles|recordings|sources)\/$/.exec(path)
    if (create !== null && method === "POST") {
      createdIds += 1
      const seeded: readonly Row[] =
        data[create[1] as "autoruns" | "sessions" | "profiles" | "recordings" | "sources"] ?? []
      const template = seeded[0] ?? {}
      return answer(200, {
        ...template,
        ...((body as Row | undefined) ?? {}),
        id: createdIds,
      })
    }

    // Discovery: a paged catalog, so a spec can watch the browser read it and
    // then filter locally without asking again.
    const discover = /^\/resolvers\/(\d+)\/discover$/.exec(path)
    if (discover !== null) {
      const catalog = data.discovery ?? []
      const asked = (body as { cursor?: string | null } | undefined)?.cursor
      const start = typeof asked === "string" ? Number(asked) : 0
      const size = data.discoveryPageSize ?? catalog.length
      const items = catalog.slice(start, start + size)
      return answer(200, { items, next_cursor: start + size < catalog.length ? String(start + size) : null })
    }

    if (path === "/sessions/") return list(data.sessions)
    if (path === "/autoruns/") return list(data.autoruns)
    if (path === "/recordings/") return list(data.recordings)
    if (path === "/profiles/") return list(data.profiles)
    if (path === "/engines/") return list(data.engines)
    if (path === "/resolvers/") return list(data.resolvers)
    if (path === "/sources/") return list(data.sources)
    if (path === "/notifications/") return list([])

    // Item routes: echo the stored row with the patch applied, so a spec can
    // assert both the request and the view's reaction to it.
    const item = /^\/(autoruns|sessions|profiles|recordings|sources)\/(\d+)$/.exec(path)
    if (item !== null) {
      if (method === "DELETE") {
        const counts = item[1] === "profiles" ? data.profileDeleteCounts : undefined
        return answer(200, { status: "deleted", deleted: counts ?? {} })
      }
      const [, collection, id] = item
      const rows: Record<string, readonly Row[] | undefined> = {
        autoruns: data.autoruns,
        sessions: data.sessions,
        profiles: data.profiles,
        recordings: data.recordings,
        sources: data.sources,
      }
      const existing = (rows[collection] ?? []).find((row) => String(row.id) === id) ?? { id: Number(id) }
      return answer(200, { ...existing, ...((body as Row | undefined) ?? {}) })
    }

    if (path === "/import-export/validate") return answer(200, data.validate ?? { items: [] })
    if (path === "/import-export/fetch") {
      return answer(200, data.fetchBundle ?? { version: 1, profiles: [], autoruns: [] })
    }
    if (path === "/import-export/apply") {
      return answer(
        200,
        data.apply ?? {
          profiles_created: 0,
          profiles_skipped: 0,
          autoruns_created: 0,
          autoruns_discarded: 0,
          discarded_autoruns: [],
        },
      )
    }

    if (path === "/admin/resources") {
      const params = new URL(request.url()).searchParams
      const type = params.get("resource_type")
      const owner = params.get("owner")
      const limit = Number(params.get("limit") ?? "50")
      const offset = Number(params.get("offset") ?? "0")
      const filtered = (data.resources ?? []).filter(
        (row) => (type === null || row.resource_type === type) && (owner === null || row.owner === owner),
      )
      return answer(200, {
        items: filtered.slice(offset, offset + limit).map((row) => {
          const key = `${row.resource_type}:${row.id}`
          return {
            ...row,
            owner_users: [...(ownerUsers[key] ?? [])],
            owner_groups: (ownerGroups[key] ?? []).map(groupName),
            grant_groups: [...new Set((groupGrants[key] ?? []).map((grant) => groupName(grant.group_id)))],
          }
        }),
        total: filtered.length,
      })
    }

    // The sharing surface: `resourceViewers` seeds VIEW-only grants (what an
    // older spec expects), `resourceGrants` seeds arbitrary capability sets, and
    // a POST/DELETE keeps both in step — the explicit set wins per user.
    const accessView = (type: string, id: string): Record<string, unknown> => {
      const row = (data.resources ?? []).find((item) => item.resource_type === type && String(item.id) === id)
      const key = `${type}:${id}`
      const byUser = new Map<string, string[]>()
      for (const username of resourceViewers[key] ?? []) byUser.set(username, ["VIEW"])
      for (const grant of explicitGrants[key] ?? []) byUser.set(grant.username, [...grant.capabilities])
      return {
        resource_type: type,
        id: Number(id),
        owner: row?.owner ?? "",
        owner_missing: false,
        grants: [...byUser].map(([username, capabilities]) => ({ username, capabilities })),
        owner_users: [...(ownerUsers[key] ?? [])],
        owner_groups: (ownerGroups[key] ?? []).map((groupId) => ({
          id: groupId,
          name: groupName(groupId),
          display_name: String(groupById(groupId)?.display_name ?? ""),
          system: Boolean(groupById(groupId)?.system),
        })),
        group_grants: (groupGrants[key] ?? []).map((grant) => ({
          group_id: grant.group_id,
          name: groupName(grant.group_id),
          display_name: String(groupById(grant.group_id)?.display_name ?? ""),
          system: Boolean(groupById(grant.group_id)?.system),
          capabilities: [...grant.capabilities],
        })),
      }
    }

    // Groups (admin console): a tiny in-memory CRUD over `data.groups`.
    if (path === "/groups") {
      if (method === "POST") {
        const payload = (body ?? {}) as { name?: string; display_name?: string }
        nextGroupId += 1
        const created: Row = {
          id: nextGroupId,
          name: payload.name ?? `group-${nextGroupId}`,
          display_name: payload.display_name ?? "",
          system: false,
          members: [] as string[],
        }
        groups.push(created)
        return answer(200, groupView(created))
      }
      return answer(200, { items: groups.map(groupView), total: groups.length })
    }

    const groupItem = /^\/groups\/(\d+)(\/members)?$/.exec(path)
    if (groupItem !== null) {
      const [, rawId, membersSuffix] = groupItem
      const id = Number(rawId)
      const row = groupById(id)
      if (row === undefined) return answer(404, { detail: "No such group" })
      if (membersSuffix === "/members" && method === "PUT") {
        row.members = [...(((body ?? {}) as { usernames?: readonly string[] }).usernames ?? [])]
        return answer(200, groupView(row))
      }
      if (method === "PATCH") {
        const payload = (body ?? {}) as { name?: string; display_name?: string }
        if (payload.name !== undefined) row.name = payload.name
        if (payload.display_name !== undefined) row.display_name = payload.display_name
        return answer(200, groupView(row))
      }
      if (method === "DELETE") {
        groups.splice(groups.indexOf(row), 1)
        for (const key of Object.keys(groupGrants)) {
          groupGrants[key] = groupGrants[key].filter((grant) => grant.group_id !== id)
        }
        for (const key of Object.keys(ownerGroups)) {
          ownerGroups[key] = ownerGroups[key].filter((groupId) => groupId !== id)
        }
        return answer(200, { status: "deleted", id })
      }
    }

    // Owner-group add/remove — additive to the single user owner.
    const ownerGroup = /^\/shares\/([^/]+)\/(\d+)\/owner-group\/(\d+)$/.exec(path)
    if (ownerGroup !== null) {
      const [, type, rawResourceId, rawGroupId] = ownerGroup
      const key = `${type}:${rawResourceId}`
      const groupId = Number(rawGroupId)
      const current = ownerGroups[key] ?? []
      ownerGroups[key] =
        method === "DELETE" ? current.filter((id) => id !== groupId) : [...new Set([...current, groupId])]
      return answer(200, accessView(type, rawResourceId))
    }

    // Group grants: the same replace-set shape as a user grant, keyed by group id.
    const groupGrant = /^\/shares\/([^/]+)\/(\d+)\/group\/(\d+)$/.exec(path)
    if (groupGrant !== null) {
      const [, type, rawResourceId, rawGroupId] = groupGrant
      const key = `${type}:${rawResourceId}`
      const groupId = Number(rawGroupId)
      const capabilities = method === "DELETE" ? [] : [...((body ?? {}) as { capabilities?: readonly string[] }).capabilities ?? []]
      const others = (groupGrants[key] ?? []).filter((grant) => grant.group_id !== groupId)
      groupGrants[key] =
        capabilities.length === 0 ? others : [...others, { group_id: groupId, capabilities }]
      return answer(200, accessView(type, rawResourceId))
    }

    // Owner-user add/remove — additive to the requester owner; must precede the
    // generic grant route below, whose `(.+)` tail would also match `owner-user/x`.
    const ownerUser = /^\/shares\/([^/]+)\/(\d+)\/owner-user\/(.+)$/.exec(path)
    if (ownerUser !== null) {
      const [, type, rawResourceId, rawUsername] = ownerUser
      const key = `${type}:${rawResourceId}`
      const username = decodeURIComponent(rawUsername)
      const current = ownerUsers[key] ?? []
      ownerUsers[key] =
        method === "DELETE" ? current.filter((name) => name !== username) : [...new Set([...current, username])]
      return answer(200, accessView(type, rawResourceId))
    }

    const sharesUser = /^\/shares\/([^/]+)\/(\d+)\/(.+)$/.exec(path)
    if (sharesUser !== null && method === "DELETE") {
      const [, type, id, rawUsername] = sharesUser
      const key = `${type}:${id}`
      const username = decodeURIComponent(rawUsername)
      resourceViewers[key] = (resourceViewers[key] ?? []).filter((viewer) => viewer !== username)
      explicitGrants[key] = (explicitGrants[key] ?? []).filter((grant) => grant.username !== username)
      return answer(200, accessView(type, id))
    }

    const sharesItem = /^\/shares\/([^/]+)\/(\d+)$/.exec(path)
    if (sharesItem !== null) {
      const [, type, id] = sharesItem
      if (method === "POST") {
        const payload = (body ?? {}) as { username?: string; capabilities?: readonly string[] }
        const key = `${type}:${id}`
        const username = payload.username ?? ""
        const capabilities = [...(payload.capabilities ?? [])]
        const others = (resourceViewers[key] ?? []).filter((viewer) => viewer !== username)
        resourceViewers[key] = capabilities.length === 0 ? others : [...others, username]
        const kept = (explicitGrants[key] ?? []).filter((grant) => grant.username !== username)
        explicitGrants[key] = capabilities.length === 0 ? kept : [...kept, { username, capabilities }]
        return answer(200, accessView(type, id))
      }
      return answer(200, accessView(type, id))
    }

    const ownerItem = /^\/admin\/resources\/([^/]+)\/(\d+)\/owner$/.exec(path)
    if (ownerItem !== null && method === "PUT") {
      const [, type, id] = ownerItem
      const username = (body as { username?: string } | undefined)?.username ?? ""
      return answer(200, { resource_type: type, id: Number(id), owner: username })
    }

    return answer(404, { detail: `No stub for ${method} ${path}` })
  })

  await page.route(/^https?:\/\/[^/]+\/health$/, (route) =>
    route.fulfill({ status: 200, body: "ok" }),
  )

  // Silent socket: open from the page's point of view, no server behind it.
  await page.routeWebSocket(/\/ws\//, () => {})

  return {
    data,
    calls,
    callsTo: (fragment) => calls.filter((call) => call.path.includes(fragment)),
  }
}

/* ── fixtures ─────────────────────────────────────────────────────── */

export const test = base.extend<{ api: ApiStub }>({
  /**
   * Auto: a spec that forgets to request `api` would otherwise reach the dev
   * server's `/api/` proxy and talk to the real core on :8000, turning an
   * authenticated test into a silent 401 → login redirect.
   */
  api: [
    async ({ page }, use) => {
      const stub = await installApi(page, {
        authenticated: true,
        sessions: [],
        autoruns: [],
        recordings: [],
        profiles: [],
        sources: [],
        engines: [],
        resolvers: [],
      })
      await use(stub)
    },
    { auto: true },
  ],
})

export { expect }
