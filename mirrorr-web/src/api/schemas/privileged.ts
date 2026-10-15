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

/** `GET …/access` response — the resource's owner and explicit view grants. */
export const ResourceAccessSchema = z
  .object({
    resource_type: z.string(),
    id: z.number(),
    owner: z.string(),
    viewers: z.array(z.string()),
  })
  .passthrough()

export type ResourceAccess = z.infer<typeof ResourceAccessSchema>

/** `PUT …/owner` response. */
export const ResourceOwnerSchema = z
  .object({
    resource_type: z.string(),
    id: z.number(),
    owner: z.string(),
  })
  .passthrough()

export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>

/** `POST`/`DELETE …/access` response — the new viewer set. */
export const ResourceViewersSchema = z
  .object({
    viewers: z.array(z.string()),
  })
  .passthrough()

export type ResourceViewers = z.infer<typeof ResourceViewersSchema>
