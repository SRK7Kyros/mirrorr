/**
 * Session endpoints (and the plugin collections D1 needs).
 *
 * Contract: `docs/web-frontend-spec.md` L426-L433 — `GET/POST /sessions/`,
 * `GET/DELETE /sessions/{id}`, `POST /sessions/{id}/stop`,
 * `POST /sessions/{id}/recording/{enable,disable}`,
 * `POST /sessions/{id}/save-as-profile`, plus `GET /engines/`,
 * `GET /resolvers/`, `GET /profiles/`. No other session endpoint exists; in
 * particular there is no "run" endpoint — "Run now" is client-composed by the
 * autorun view (todo 14).
 */
import type { z } from "zod"
import { apiFetch } from "@/lib/api"
import { PAGE_LIMIT_PLUGINS, fetchAllPages } from "@/lib/pagination"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"
import { engineSchema, profileSchema, resolverSchema, type Engine, type Profile, type Resolver } from "@/lib/schemas/plugins"
import { sessionSchema, type Session } from "@/lib/schemas/sessions"

/** Structurally identical to `InfinitePageRequest` (`src/hooks/use-infinite-list.ts`). */
export interface SessionPageRequest {
  readonly cursor: number | null
  readonly limit: number
  readonly signal: AbortSignal
}

/**
 * `POST /sessions/` body (spec L401 + client spec §4).
 *
 * The unedited-profile form sends `{profile_id, recording}` only; any field
 * edit sends the full explicit form (`engine_id`, `resolver_id`,
 * `resolver_config`, `retry_mode`, `retry_config`, `recording`). The server
 * snapshots the submitted config onto the session.
 */
export interface CreateSessionBody {
  readonly profile_id?: number
  readonly engine_id?: number
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
  readonly recording: boolean
}

function pageQuery(cursor: number | null, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor !== null) params.set("cursor", String(cursor))
  return params.toString()
}

export function fetchSessionsPage(request: SessionPageRequest): Promise<CursorPage<Session>> {
  return apiFetch<CursorPage<Session>>(`/sessions/?${pageQuery(request.cursor, request.limit)}`, {
    schema: cursorPageSchema(sessionSchema),
    signal: request.signal,
  })
}

export function createSession(body: CreateSessionBody): Promise<Session> {
  return apiFetch<Session>("/sessions/", { method: "POST", body, schema: sessionSchema })
}

/** `GET /sessions/{id}` — the authoritative refetch after a control timeout. */
export function fetchSession(id: number): Promise<Session> {
  return apiFetch<Session>(`/sessions/${id}`, { schema: sessionSchema })
}

export function stopSession(id: number): Promise<void> {
  return apiFetch(`/sessions/${id}/stop`, { method: "POST" })
}

export function enableSessionRecording(id: number): Promise<void> {
  return apiFetch(`/sessions/${id}/recording/enable`, { method: "POST" })
}

export function disableSessionRecording(id: number): Promise<void> {
  return apiFetch(`/sessions/${id}/recording/disable`, { method: "POST" })
}

export function saveSessionAsProfile(id: number, name: string): Promise<void> {
  return apiFetch(`/sessions/${id}/save-as-profile`, { method: "POST", body: { name } })
}

export function deleteSession(id: number): Promise<void> {
  return apiFetch(`/sessions/${id}`, { method: "DELETE" })
}

async function fetchCollection<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<readonly T[]> {
  return fetchAllPages<T>(
    async ({ cursor, limit, signal: pageSignal }) =>
      apiFetch<CursorPage<T>>(`${path}?${pageQuery(cursor, limit)}`, {
        schema: cursorPageSchema(schema),
        signal: pageSignal,
      }),
    { limit: PAGE_LIMIT_PLUGINS, signal },
  )
}

export function fetchAllEngines(signal?: AbortSignal): Promise<readonly Engine[]> {
  return fetchCollection("/engines/", engineSchema, signal)
}

export function fetchAllResolvers(signal?: AbortSignal): Promise<readonly Resolver[]> {
  return fetchCollection("/resolvers/", resolverSchema, signal)
}

export function fetchAllProfiles(signal?: AbortSignal): Promise<readonly Profile[]> {
  return fetchCollection("/profiles/", profileSchema, signal)
}
