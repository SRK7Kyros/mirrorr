import { z } from "zod"

/**
 * Cursor pagination envelope (`PaginatedResponse` + typed list variants).
 * The server gives no reliable total for filtered lists — consumers show
 * "Showing N", never a fake total.
 */
export function cursorPageSchema<T extends z.ZodType>(item: T) {
  return z
    .object({
      items: z.array(item),
      next_cursor: z.number().nullable().optional(),
      has_more: z.boolean(),
      total: z.number().nullable().optional(),
    })
    .passthrough()
}

export type CursorPage<T> = {
  items: T[]
  next_cursor?: number | null
  has_more: boolean
  total?: number | null
}
