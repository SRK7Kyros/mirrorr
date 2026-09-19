/**
 * Parsing of the server's uniform error envelope.
 *
 * Contract: `docs/general-client-specification.md` §1.3 and §13.9.5 —
 * a `detail` string, a pydantic-style `detail[]` array of
 * `{loc, msg}` items, or the custom `{detail, errors:[...]}` shape.
 */
import { z } from "zod"
import type { FieldErrors } from "@/lib/errors"

/** Toast copy for a 422 whose `detail` is the pydantic array (no string form). */
export const VALIDATION_FAILED_DETAIL = "Validation failed"

const locSegmentSchema = z.union([z.string(), z.number()])

const fieldErrorItemSchema = z.object({
  loc: z.array(locSegmentSchema).optional(),
  msg: z.string().optional(),
})

export const errorEnvelopeSchema = z.object({
  detail: z.union([z.string(), z.array(fieldErrorItemSchema)]).optional(),
  errors: z.array(fieldErrorItemSchema).optional(),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

/**
 * pydantic location prefixes that address the transport, not the form field:
 * `["body","engine_id"]` is the field `engine_id`.
 */
const LOC_PREFIXES = new Set(["body", "query", "path", "header", "cookie"])

function fieldKey(loc: ReadonlyArray<string | number> | undefined): string | undefined {
  if (!loc || loc.length === 0) return undefined

  const [head, ...rest] = loc
  const segments = typeof head === "string" && LOC_PREFIXES.has(head) ? rest : loc
  if (segments.length === 0) return undefined

  return segments.map(String).join(".")
}

/**
 * Maps a 422 payload onto per-field messages. Returns `undefined` when the
 * envelope is not a recognized error shape or carries no usable `loc`.
 */
export function fieldErrorsFromEnvelope(envelope: unknown): FieldErrors | undefined {
  const parsed = errorEnvelopeSchema.safeParse(envelope)
  if (!parsed.success) return undefined

  const items = Array.isArray(parsed.data.detail)
    ? parsed.data.detail
    : (parsed.data.errors ?? [])

  const entries: Array<readonly [string, string]> = []
  for (const item of items) {
    const key = fieldKey(item.loc)
    const message = item.msg?.trim()
    if (key === undefined || !message) continue
    entries.push([key, message])
  }

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** The toast-facing message of an error envelope, when one can be derived. */
export function detailFromEnvelope(envelope: unknown): string | undefined {
  const parsed = errorEnvelopeSchema.safeParse(envelope)
  if (!parsed.success) return undefined

  const { detail } = parsed.data
  if (typeof detail === "string" && detail.trim().length > 0) return detail
  if (Array.isArray(detail) && detail.length > 0) return VALIDATION_FAILED_DETAIL
  return undefined
}
