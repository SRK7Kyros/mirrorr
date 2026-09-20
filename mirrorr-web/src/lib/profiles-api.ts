/**
 * Profile endpoints.
 *
 * Contract: `docs/general-client-specification.md` §3 — CRUD under
 * `/profiles/`; `POST` returns 200 with the profile, 400 on a duplicate name,
 * 422 with a `loc` when `resolver_config` violates the resolver's schema; `PUT`
 * is a partial (exclude-unset) update; `DELETE` is 204.
 */
import { apiFetch } from "@/lib/api"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"
import { profileSchema, type Profile } from "@/lib/schemas/plugins"

export interface ProfilePageRequest {
  readonly cursor: number | null
  readonly limit: number
  readonly signal: AbortSignal
}

export interface CreateProfileBody {
  readonly name: string
  readonly default_engine_id: number
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
}

export type UpdateProfileBody = Partial<CreateProfileBody>

function pageQuery(cursor: number | null, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor !== null) params.set("cursor", String(cursor))
  return params.toString()
}

export function fetchProfilesPage(request: ProfilePageRequest): Promise<CursorPage<Profile>> {
  return apiFetch<CursorPage<Profile>>(`/profiles/?${pageQuery(request.cursor, request.limit)}`, {
    schema: cursorPageSchema(profileSchema),
    signal: request.signal,
  })
}

export function createProfile(body: CreateProfileBody): Promise<Profile> {
  return apiFetch<Profile>("/profiles/", { method: "POST", body, schema: profileSchema })
}

export function updateProfile(id: number, body: UpdateProfileBody): Promise<Profile> {
  return apiFetch<Profile>(`/profiles/${id}`, { method: "PUT", body, schema: profileSchema })
}

export function deleteProfile(id: number): Promise<void> {
  return apiFetch(`/profiles/${id}`, { method: "DELETE" })
}
