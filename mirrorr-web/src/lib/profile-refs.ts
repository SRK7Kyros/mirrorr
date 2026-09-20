/**
 * V8's delete pre-scan.
 *
 * Contract: `docs/web-frontend-spec.md` L331 + client contract §13.6 — before
 * confirming a profile delete the client counts the autoruns/sessions that
 * reference it and lists them ("In use by N autoruns / M sessions"). The scan
 * reads the cached lists and only fetches them when the cache is cold.
 *
 * Names: an autorun's `user_friendly_name`; a session has no name field, so it
 * renders `#<id>`.
 */
import type { QueryClient } from "@tanstack/react-query"
import type { Autorun } from "@/lib/schemas/autoruns"
import { fetchAutorunsPage } from "@/lib/autoruns-api"
import { PAGE_LIMIT_DEFAULT, fetchAllPages } from "@/lib/pagination"
import { queryKeys } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas/sessions"
import { fetchSessionsPage } from "@/lib/sessions-api"

export interface ProfileRef {
  readonly id: number
  readonly name: string
}

export interface ProfileRefs {
  readonly autoruns: readonly ProfileRef[]
  readonly sessions: readonly ProfileRef[]
}

type RefRow = Autorun | Session

function refFromRow(row: RefRow): ProfileRef {
  if ("user_friendly_name" in row) {
    const friendly = row.user_friendly_name
    if (typeof friendly === "string" && friendly !== "") return { id: row.id, name: friendly }
  }
  return { id: row.id, name: `#${row.id}` }
}

function refsFromRows(
  autoruns: readonly RefRow[],
  sessions: readonly RefRow[],
  profileId: number,
): ProfileRefs {
  return {
    autoruns: autoruns.filter((row) => row.profile_id === profileId).map(refFromRow),
    sessions: sessions.filter((row) => row.profile_id === profileId).map(refFromRow),
  }
}

/**
 * Merges every cached page under a list root. `null` means "no cached data at
 * all" (cold), which is the signal to fetch; `[]` means "loaded and empty".
 */
function rowsFromCache(client: QueryClient, root: "autoruns" | "sessions"): readonly RefRow[] | null {
  const queries = client.getQueryCache().findAll({ queryKey: [root] })
  let loaded = false
  const rows: RefRow[] = []

  for (const query of queries) {
    const data = query.state.data as
      | { readonly pages?: ReadonlyArray<{ readonly items?: readonly unknown[] }> }
      | undefined
    if (data?.pages === undefined) continue
    loaded = true
    for (const page of data.pages) {
      for (const item of page.items ?? []) {
        if (typeof item === "object" && item !== null) rows.push(item as RefRow)
      }
    }
  }

  return loaded ? rows : null
}

/** Cache-only scan; empty lists when nothing is cached. */
export function cachedProfileRefs(client: QueryClient, profileId: number): ProfileRefs {
  return refsFromRows(
    rowsFromCache(client, "autoruns") ?? [],
    rowsFromCache(client, "sessions") ?? [],
    profileId,
  )
}

function signalOf(signal: AbortSignal | undefined): AbortSignal {
  return signal ?? new AbortController().signal
}

/** Cache-first scan; cold lists are fetched (all pages) before counting. */
export async function collectProfileRefs(client: QueryClient, profileId: number): Promise<ProfileRefs> {
  const cachedAutoruns = rowsFromCache(client, "autoruns")
  const cachedSessions = rowsFromCache(client, "sessions")
  if (cachedAutoruns !== null && cachedSessions !== null) {
    return refsFromRows(cachedAutoruns, cachedSessions, profileId)
  }

  const [autoruns, sessions] = await Promise.all([
    cachedAutoruns ??
      fetchAllPages<Autorun>(
        ({ cursor, limit, signal }) => fetchAutorunsPage({ cursor, limit, signal: signalOf(signal) }),
        { limit: PAGE_LIMIT_DEFAULT },
      ),
    cachedSessions ??
      fetchAllPages<Session>(
        ({ cursor, limit, signal }) => fetchSessionsPage({ cursor, limit, signal: signalOf(signal) }),
        { limit: PAGE_LIMIT_DEFAULT },
      ),
  ])

  return refsFromRows(autoruns, sessions, profileId)
}

/** Exported for the view: the query roots the pre-scan owns. */
export const PROFILE_REF_QUERY_KEYS = {
  autoruns: queryKeys.autoruns(),
  sessions: queryKeys.sessions(),
} as const
