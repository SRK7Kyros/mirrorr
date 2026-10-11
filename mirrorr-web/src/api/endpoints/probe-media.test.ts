import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearProbeCache, probeMediaUrl } from "./index"

/**
 * The probe cache must not memoise a failure (a transient network error would
 * permanently hide the preview) and must stay bounded.
 */
describe("probeMediaUrl", () => {
  beforeEach(() => {
    clearProbeCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("probes a URL once and reuses the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeMediaUrl("/a.mp4")).resolves.toBe(true)
    await expect(probeMediaUrl("/a.mp4")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not cache a failed probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeMediaUrl("/b.mp4")).resolves.toBe(false)
    await Promise.resolve()
    await expect(probeMediaUrl("/b.mp4")).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})