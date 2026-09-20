/**
 * V7's once-per-session media reachability probe (spec L319; client contract
 * §13.11.5/§13.12.2): exactly one HEAD on the first Open click of a session,
 * never one per row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { probeMediaOnce, resetMediaProbeSession } from "@/lib/media-probe"

beforeEach(() => {
  resetMediaProbeSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("probeMediaOnce", () => {
  it("issues one HEAD request and reports a served file as reachable", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeMediaOnce("https://example.com/content/a.mp4")).resolves.toEqual({
      kind: "reachable",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "HEAD" })
  })

  it("reports a 404 as unreachable and never probes again in the session", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeMediaOnce("https://example.com/content/a.mp4")).resolves.toEqual({
      kind: "unreachable",
    })
    await expect(probeMediaOnce("https://example.com/content/b.mp4")).resolves.toEqual({
      kind: "already-probed",
    })
    await expect(probeMediaOnce("https://example.com/content/c.mp4")).resolves.toEqual({
      kind: "already-probed",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports a 403 as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })))
    await expect(probeMediaOnce("https://example.com/content/a.mp4")).resolves.toEqual({
      kind: "unreachable",
    })
  })

  it("reports a network failure as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )
    await expect(probeMediaOnce("https://example.com/content/a.mp4")).resolves.toEqual({
      kind: "unreachable",
    })
  })
})
