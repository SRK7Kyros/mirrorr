import { z } from "zod"
import { ApiError, apiFetch } from "@/api/client"
import {
  AccessViewSchema,
  AdminResourcePageSchema,
  ResourceOwnerSchema,
  type AccessView,
  type AdminResourcePage,
  type Capability,
  type ResourceOwner,
} from "@/api/schemas/privileged"

/**
 * Sharing endpoints (plan: `granular-permissions-and-access-panel`).
 *
 * `/shares/` is the one sharing surface; the server gates each route on the
 * SHARE capability (owner | admin | SHARE holder). `PUT …/owner` stays on the
 * admin router. Shapes are the frozen contract in
 * `.omo/plans/granular-permissions-and-access-panel.md` — the core lane owns
 * the implementation. `parseOrThrow` mirrors `endpoints/settings.ts`: a shape
 * mismatch warns and surfaces as `ApiError(0, "Unexpected server response")`.
 */

export interface AdminResourceQuery {
  readonly resource_type?: string
  readonly owner?: string
  readonly limit?: number
  readonly offset?: number
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.warn("Unexpected server response", result.error)
    throw new ApiError(0, "Unexpected server response")
  }
  return result.data
}

/** `/shares/{type}/{id}` — the prefix every sharing route hangs off. */
function sharePath(resourceType: string, id: number): string {
  return `/shares/${encodeURIComponent(resourceType)}/${id}`
}

/** `GET /admin/resources` — one offset page of every item, system rows included. */
export function fetchAdminResources(query: AdminResourceQuery = {}): Promise<AdminResourcePage> {
  const params = new URLSearchParams()
  if (query.resource_type !== undefined && query.resource_type !== "") {
    params.set("resource_type", query.resource_type)
  }
  if (query.owner !== undefined && query.owner !== "") params.set("owner", query.owner)
  if (query.limit !== undefined) params.set("limit", String(query.limit))
  if (query.offset !== undefined) params.set("offset", String(query.offset))
  const suffix = params.toString()
  return apiFetch<unknown>(`/admin/resources${suffix === "" ? "" : `?${suffix}`}`).then((data) =>
    parseOrThrow(AdminResourcePageSchema, data),
  )
}

/** `GET /shares/{type}/{id}` — the owner plus every explicit capability grant. */
export function fetchResourceAccess(resourceType: string, id: number): Promise<AccessView> {
  return apiFetch<unknown>(sharePath(resourceType, id)).then((data) =>
    parseOrThrow(AccessViewSchema, data),
  )
}

/** `PUT /admin/resources/{type}/{id}/owner` — reassign ownership (admin-only, idempotent). */
export function setResourceOwner(
  resourceType: string,
  id: number,
  username: string,
): Promise<ResourceOwner> {
  return apiFetch<unknown>(`/admin/resources/${encodeURIComponent(resourceType)}/${id}/owner`, {
    method: "PUT",
    body: { username },
  }).then((data) => parseOrThrow(ResourceOwnerSchema, data))
}

/**
 * `POST /shares/{type}/{id}` — REPLACE-SET one user's capabilities (idempotent).
 * Renamed from `grantResourceViewer`, which lied: the body is the user's whole
 * capability set, not a single view grant.
 */
export function setResourceGrants(
  resourceType: string,
  id: number,
  username: string,
  capabilities: readonly Capability[],
): Promise<AccessView> {
  return apiFetch<unknown>(sharePath(resourceType, id), {
    method: "POST",
    body: { username, capabilities },
  }).then((data) => parseOrThrow(AccessViewSchema, data))
}

/**
 * `DELETE /shares/{type}/{id}/{username}` — clear every grant for one user
 * (idempotent). Renamed from `revokeResourceViewer`, which lied: it clears
 * every capability for the user, not a single view grant.
 */
export function revokeResourceUser(
  resourceType: string,
  id: number,
  username: string,
): Promise<AccessView> {
  return apiFetch<unknown>(`${sharePath(resourceType, id)}/${encodeURIComponent(username)}`, {
    method: "DELETE",
  }).then((data) => parseOrThrow(AccessViewSchema, data))
}
