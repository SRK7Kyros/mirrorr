/**
 * Autorun endpoints.
 *
 * Contract: `docs/web-frontend-spec.md` L426-L433 and
 * `docs/general-client-specification.md` §5 — `GET/POST /autoruns/`,
 * `GET/PUT/DELETE /autoruns/{id}`, `POST /autoruns/{id}/save-as-profile`.
 * There is no server "run" endpoint: run-now is composed client-side from
 * `POST /sessions/` with the autorun's engine/resolver/config/retry copy.
 * Export (`GET /import-export/autoruns/{id}/export`) belongs to todo 23.
 */
import { apiFetch } from "@/lib/api"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"
import { autorunSchema, type Autorun } from "@/lib/schemas/autoruns"
import type { CreateSessionBody } from "@/lib/sessions-api"

/** Structurally identical to `InfinitePageRequest`. */
export interface AutorunPageRequest {
  readonly cursor: number | null
  readonly limit: number
  readonly signal: AbortSignal
}

/**
 * `POST /autoruns/` body (client spec §5): the name pair plus either the
 * unedited `profile_id` short form or the full explicit config form.
 * `start_time`/`end_time` are naive-UTC strings (no offset, no `Z`).
 */
export interface CreateAutorunBody {
  readonly user_friendly_name: string
  readonly snake_case_name: string
  readonly profile_id?: number
  readonly engine_id?: number
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
  readonly start_time: string
  readonly end_time: string
  readonly recording: boolean
}

/** `PUT /autoruns/{id}` — only the dirty fields, `exclude_unset` semantics. */
export type UpdateAutorunBody = Partial<Omit<CreateAutorunBody, "recording">> & {
  readonly recording?: boolean
}

function pageQuery(cursor: number | null, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor !== null) params.set("cursor", String(cursor))
  return params.toString()
}

export function fetchAutorunsPage(request: AutorunPageRequest): Promise<CursorPage<Autorun>> {
  return apiFetch<CursorPage<Autorun>>(`/autoruns/?${pageQuery(request.cursor, request.limit)}`, {
    schema: cursorPageSchema(autorunSchema),
    signal: request.signal,
  })
}

export function fetchAutorun(id: number): Promise<Autorun> {
  return apiFetch<Autorun>(`/autoruns/${id}`, { schema: autorunSchema })
}

export function createAutorun(body: CreateAutorunBody): Promise<Autorun> {
  return apiFetch<Autorun>("/autoruns/", { method: "POST", body, schema: autorunSchema })
}

export function updateAutorun(id: number, body: UpdateAutorunBody): Promise<Autorun> {
  return apiFetch<Autorun>(`/autoruns/${id}`, { method: "PUT", body, schema: autorunSchema })
}

export function deleteAutorun(id: number): Promise<void> {
  return apiFetch(`/autoruns/${id}`, { method: "DELETE" })
}

export function saveAutorunAsProfile(id: number, name: string): Promise<void> {
  return apiFetch(`/autoruns/${id}/save-as-profile`, { method: "POST", body: { name } })
}

/**
 * "Run now" (spec L285): no run endpoint exists, so the client spawns a
 * session through `POST /sessions/` carrying the autorun's config verbatim.
 */
export function buildRunNowSessionBody(autorun: Autorun): CreateSessionBody {
  return {
    engine_id: autorun.engine_id,
    resolver_id: autorun.resolver_id,
    resolver_config: autorun.resolver_config ?? {},
    retry_mode: autorun.retry_mode ?? "none",
    retry_config: autorun.retry_config ?? {},
    recording: autorun.recording === true,
  }
}
