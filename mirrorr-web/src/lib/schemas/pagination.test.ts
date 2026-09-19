import { describe, expect, it } from "vitest"
import { z } from "zod"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"

const sessionSchema = z.object({ id: z.number(), status: z.string() })

describe("cursorPageSchema", () => {
  it("parses the cursor envelope into a typed page", () => {
    const page: CursorPage<z.infer<typeof sessionSchema>> = cursorPageSchema(sessionSchema).parse({
      items: [{ id: 4, status: "live" }],
      next_cursor: 4,
      has_more: true,
    })

    expect(page.next_cursor).toBe(4)
    expect(page.has_more).toBe(true)
    expect(page.items).toEqual([{ id: 4, status: "live" }])
  })

  it("accepts a null cursor and rejects a malformed envelope", () => {
    const schema = cursorPageSchema(sessionSchema)

    expect(schema.safeParse({ items: [], next_cursor: null, has_more: false }).success).toBe(true)
    expect(schema.safeParse({ items: "nope", has_more: false }).success).toBe(false)
  })
})
