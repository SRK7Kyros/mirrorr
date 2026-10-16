import { z } from "zod"

const adminOnly = { requester_user_token: z.string().optional() }

/**
 * Response fields the backend withholds from a non-admin — from the payload and
 * from the OpenAPI document alike. `__ADMIN__` is a build-time constant, so the
 * standard bundle carries an empty shape and declares nothing about them; the
 * annotation keeps the field's type identical in both builds.
 */
export const adminOnlyFields: typeof adminOnly = __ADMIN__ ? adminOnly : ({} as typeof adminOnly)

/* ── Admin resource access (plan: admin-ownership-and-access) ─────────
 *
 * Rows the admin console reads/writes. Shapes mirror the frozen contract in
 * `.omo/plans/admin-ownership-and-access.md`; the core lane owns the server.
 * `resource_type` is a free string so a system row (`engine`/`resolver`) and
 * the owner-bearing types flow through the same schema.
 */

/** The owner-bearing resource types the type filter offers. */
export const RESOURCE_TYPES = ["session", "profile", "autorun", "recording", "source"] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]

/** `GET /admin/resources` row. `system:true, owner:""` for engines/resolvers. */
const AdminResourceSchema = z
  .object({
    resource_type: z.string(),
    id: z.number(),
    label: z.string(),
    owner: z.string(),
    owner_missing: z.boolean(),
    viewer_count: z.number(),
    system: z.boolean(),
  })
  .passthrough()

export type AdminResource = z.infer<typeof AdminResourceSchema>

/** `GET /admin/resources` envelope. */
export const AdminResourcePageSchema = z
  .object({
    items: z.array(AdminResourceSchema),
    total: z.number(),
  })
  .passthrough()

export type AdminResourcePage = z.infer<typeof AdminResourcePageSchema>

/* ── Sharing / capabilities (plan: granular-permissions-and-access-panel) ──
 *
 * The one sharing shape, served by `/shares/{resource_type}/{resource_id}`
 * (GET/POST/DELETE). It replaces the old `/admin/resources/{t}/{id}/access*`
 * routes; the old flat `{owner, viewers}` shape is gone and must not be
 * accepted here (a stale cached body would parse as an empty grant set).
 */

/** The six capability values, in the frozen enumeration order. */
export const CAPABILITIES = ["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"] as const
export type Capability = (typeof CAPABILITIES)[number]

/** A capability value; an unknown string is rejected, never coerced. */
export const CapabilitySchema = z.enum(CAPABILITIES)

/** One user's explicit capabilities. */
export const AccessGrantSchema = z
  .object({
    username: z.string(),
    capabilities: z.array(CapabilitySchema),
  })
  .passthrough()

export type AccessGrant = z.infer<typeof AccessGrantSchema>

/** `GET|POST|DELETE /shares/{resource_type}/{resource_id}` response. */
export const AccessViewSchema = z
  .object({
    resource_type: z.string(),
    id: z.number(),
    owner: z.string().nullable(),
    owner_missing: z.boolean(),
    grants: z.array(AccessGrantSchema),
  })
  .passthrough()

export type AccessView = z.infer<typeof AccessViewSchema>

/** `PUT /admin/resources/{type}/{id}/owner` response (admin-only, unchanged). */
export const ResourceOwnerSchema = z
  .object({
    resource_type: z.string(),
    id: z.number(),
    owner: z.string(),
  })
  .passthrough()

export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>
