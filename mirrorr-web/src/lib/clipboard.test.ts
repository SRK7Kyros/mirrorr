/**
 * Clipboard helper for the V9 origin-hash copy buttons: the async Clipboard
 * API when available, a false result (never a throw) when it is not.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { copyText } from "@/lib/clipboard"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("copyText", () => {
  it("writes through the Clipboard API and reports success", async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    await expect(copyText("abc123")).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith("abc123")
  })

  it("reports failure without throwing when the API is missing", async () => {
    vi.stubGlobal("navigator", {})
    await expect(copyText("abc123")).resolves.toBe(false)
  })

  it("reports failure when the write rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied")
        }),
      },
    })
    await expect(copyText("abc123")).resolves.toBe(false)
  })
})
