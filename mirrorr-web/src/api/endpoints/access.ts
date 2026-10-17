import { z } from "zod"
import { ApiError, apiFetch } from "@/api/client"
import {
  AccessViewSchema,
  AdminResourcePageSchema,
  GroupDeletedSchema,
  GroupPageSchema,
  GroupSchema,
  ResourceOwnerSchema,
  type AccessView,
  type AdminResourcePage,
  type Capability,
  type Group,
  type GroupDeleted,
  type GroupPage,
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

/** The body `PUT …/owner` takes: exactly one of the two kinds of crown. */
export type OwnerTarget = { readonly username: string } | { readonly group_id: number }

/** `PUT /admin/resources/{type}/{id}/owner` — set the crown, to a user or a group. */
export function setResourceOwner(
  resourceType: string,
  id: number,
  target: OwnerTarget,
): Promise<ResourceOwner> {
  return apiFetch<unknown>(`/admin/resources/${encodeURIComponent(resourceType)}/${id}/owner`, {
    method: "PUT",
    body: target,
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

/* ── groups (admin-only) ───────────────────────────────────────────────
 *
 * Group CRUD lives on `/groups` (admin router); membership is a replace-set
 * PUT. The sealed `everyone` group (`system: true`) rejects rename, delete and
 * member edits server-side, so the UI renders it read-only.
 */

/** `GET /groups` — every group, the sealed `everyone` row included. */
export function fetchGroups(): Promise<GroupPage> {
  return apiFetch<unknown>("/groups").then((data) => parseOrThrow(GroupPageSchema, data))
}

/** `POST /groups` — create a group. */
export function createGroup(name: string, displayName: string): Promise<Group> {
  return apiFetch<unknown>("/groups", { method: "POST", body: { name, display_name: displayName } }).then(
    (data) => parseOrThrow(GroupSchema, data),
  )
}

export interface GroupUpdateBody {
  readonly name?: string
  readonly display_name?: string
}

/** `PATCH /groups/{id}` — rename and/or re-label a group. */
export function updateGroup(id: number, body: GroupUpdateBody): Promise<Group> {
  return apiFetch<unknown>(`/groups/${id}`, { method: "PATCH", body }).then((data) =>
    parseOrThrow(GroupSchema, data),
  )
}

/** `DELETE /groups/{id}` — drop the group and its grants/ownership rows. */
export function deleteGroup(id: number): Promise<GroupDeleted> {
  return apiFetch<unknown>(`/groups/${id}`, { method: "DELETE" }).then((data) =>
    parseOrThrow(GroupDeletedSchema, data),
  )
}

/** `PUT /groups/{id}/members` — REPLACE-SET the member list (idempotent). */
export function setGroupMembers(id: number, usernames: readonly string[]): Promise<Group> {
  return apiFetch<unknown>(`/groups/${id}/members`, { method: "PUT", body: { usernames } }).then((data) =>
    parseOrThrow(GroupSchema, data),
  )
}

/* ── group grants / owners (shares router) ─────────────────────────────
 *
 * A group grant is the same replace-set shape as a user grant, keyed by group
 * id. Owners are a list: a user-owner or group-owner row is additive and never
 * touches the single requester owner.
 */

function shareGroupPath(resourceType: string, id: number, groupId: number): string {
  return `${sharePath(resourceType, id)}/group/${groupId}`
}

function shareOwnerGroupPath(resourceType: string, id: number, groupId: number): string {
  return `${sharePath(resourceType, id)}/owner-group/${groupId}`
}

/** `POST /shares/{type}/{id}/group/{group_id}` — REPLACE-SET one group's capabilities. */
export function setGroupGrants(
  resourceType: string,
  id: number,
  groupId: number,
  capabilities: readonly Capability[],
): Promise<AccessView> {
  return apiFetch<unknown>(shareGroupPath(resourceType, id, groupId), {
    method: "POST",
    body: { capabilities },
  }).then((data) => parseOrThrow(AccessViewSchema, data))
}

/** `DELETE /shares/{type}/{id}/group/{group_id}` — clear every grant for one group. */
export function revokeGroupGrants(
  resourceType: string,
  id: number,
  groupId: number,
): Promise<AccessView> {
  return apiFetch<unknown>(shareGroupPath(resourceType, id, groupId), { method: "DELETE" }).then(
    (data) => parseOrThrow(AccessViewSchema, data),
  )
}

/** `PUT /shares/{type}/{id}/owner-group/{group_id}` — add an owner group (idempotent). */
export function addResourceOwnerGroup(
  resourceType: string,
  id: number,
  groupId: number,
): Promise<AccessView> {
  return apiFetch<unknown>(shareOwnerGroupPath(resourceType, id, groupId), { method: "PUT" }).then(
    (data) => parseOrThrow(AccessViewSchema, data),
  )
}

/** `DELETE /shares/{type}/{id}/owner-group/{group_id}` — remove an owner group (idempotent). */
export function removeResourceOwnerGroup(
  resourceType: string,
  id: number,
  groupId: number,
): Promise<AccessView> {
  return apiFetch<unknown>(shareOwnerGroupPath(resourceType, id, groupId), { method: "DELETE" }).then(
    (data) => parseOrThrow(AccessViewSchema, data),
  )
}

function shareOwnerUserPath(resourceType: string, id: number, username: string): string {
  return `${sharePath(resourceType, id)}/owner-user/${encodeURIComponent(username)}`
}

/** `PUT /shares/{type}/{id}/owner-user/{username}` — add an owner user (idempotent). */
export function addResourceOwnerUser(
  resourceType: string,
  id: number,
  username: string,
): Promise<AccessView> {
  return apiFetch<unknown>(shareOwnerUserPath(resourceType, id, username), { method: "PUT" }).then(
    (data) => parseOrThrow(AccessViewSchema, data),
  )
}

/** `DELETE /shares/{type}/{id}/owner-user/{username}` — remove an owner user (idempotent). */
export function removeResourceOwnerUser(
  resourceType: string,
  id: number,
  username: string,
): Promise<AccessView> {
  return apiFetch<unknown>(shareOwnerUserPath(resourceType, id, username), { method: "DELETE" }).then(
    (data) => parseOrThrow(AccessViewSchema, data),
  )
}
