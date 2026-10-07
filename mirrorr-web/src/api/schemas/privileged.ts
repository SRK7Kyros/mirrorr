import { z } from "zod"

const adminOnly = { requester_user_token: z.string().optional() }

/**
 * Response fields the backend withholds from a non-admin — from the payload and
 * from the OpenAPI document alike. `__ADMIN__` is a build-time constant, so the
 * standard bundle carries an empty shape and declares nothing about them; the
 * annotation keeps the field's type identical in both builds.
 */
export const adminOnlyFields: typeof adminOnly = __ADMIN__ ? adminOnly : ({} as typeof adminOnly)
