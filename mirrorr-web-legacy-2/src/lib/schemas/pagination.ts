/**
 * Cursor pagination envelope.
 *
 * Contract: `docs/general-client-specification.md` §1.4 and §13.9.2 —
 * every list GET answers `{items, next_cursor, has_more}`; `next_cursor` is
 * the id of the last item on the page, or `null` when none.
 */
import { z } from "zod"

/** Parsed public shape of any list response. */
export interface CursorPage<T> {
  readonly items: readonly T[]
  readonly next_cursor: number | null
  readonly has_more: boolean
}

export function cursorPageSchema<S extends z.ZodType>(itemSchema: S) {
  return z.object({
    items: z.array(itemSchema),
    next_cursor: z.number().int().nullable(),
    has_more: z.boolean(),
  })
}
