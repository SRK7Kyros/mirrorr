import { z } from "zod"
import { ApiError, apiFetch } from "@/api/client"
import {
  AdminResourcePageSchema,
  ResourceAccessSchema,
  ResourceOwnerSchema,
  ResourceViewersSchema,
  type AdminResourcePage,
  type ResourceAccess,
  type ResourceOwner,
  type ResourceViewers,
} from "@/api/schemas/privileged"

/**
 * Admin resource-access endpoints (plan: `admin-ownership-and-access`).
 *
 * Every path requires an admin principal; the server answers 403 otherwise.
 * Shapes are the frozen contract in `.omo/plans/admin-ownership-and-access.md`
 * — the core lane owns the implementation. `parseOrThrow` mirrors
 * `endpoints/settings.ts`: a shape mismatch warns and surfaces as
 * `ApiError(0, "Unexpected server response")`.
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

/** `/admin/resources/{type}/{id}` — the shared prefix of every item route. */
function resourcePath(resourceType: string, id: number): string {
  return `/admin/resources/${encodeURIComponent(resourceType)}/${id}`
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

/** `GET …/access` — the owner and the explicit view grants. */
export function fetchResourceAccess(resourceType: string, id: number): Promise<ResourceAccess> {
  return apiFetch<unknown>(`${resourcePath(resourceType, id)}/access`).then((data) =>
    parseOrThrow(ResourceAccessSchema, data),
  )
}

/** `PUT …/owner` — reassign ownership (idempotent on the server). */
export function setResourceOwner(resourceType: string, id: number, username: string): Promise<ResourceOwner> {
  return apiFetch<unknown>(`${resourcePath(resourceType, id)}/owner`, {
    method: "PUT",
    body: { username },
  }).then((data) => parseOrThrow(ResourceOwnerSchema, data))
}

/** `POST …/access` — grant a user view access (idempotent on the server). */
export function grantResourceViewer(
  resourceType: string,
  id: number,
  username: string,
): Promise<ResourceViewers> {
  return apiFetch<unknown>(`${resourcePath(resourceType, id)}/access`, {
    method: "POST",
    body: { username },
  }).then((data) => parseOrThrow(ResourceViewersSchema, data))
}

/** `DELETE …/access/{username}` — revoke a view grant. */
export function revokeResourceViewer(
  resourceType: string,
  id: number,
  username: string,
): Promise<ResourceViewers> {
  return apiFetch<unknown>(`${resourcePath(resourceType, id)}/access/${encodeURIComponent(username)}`, {
    method: "DELETE",
  }).then((data) => parseOrThrow(ResourceViewersSchema, data))
}
