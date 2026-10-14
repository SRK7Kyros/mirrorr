import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SessionUrls, pickPlayableUrl, stripOrigin, toSessionUrls } from "./session-urls"

describe("toSessionUrls", () => {
  it("keeps labelled entries that carry a URL and drops the empty ones", () => {
    expect(
      toSessionUrls([
        { label: "M3U8", url: "https://x/stream.m3u8" },
        { label: "Empty", url: "" },
      ]),
    ).toEqual([{ label: "M3U8", url: "https://x/stream.m3u8" }])
  })

  it("reads a bare record without an explicit label", () => {
    expect(toSessionUrls([{ VLC: "https://x/vlc.html" }])).toEqual([{ label: "VLC", url: "https://x/vlc.html" }])
  })

  it("is empty for undefined", () => {
    expect(toSessionUrls(undefined)).toEqual([])
  })
})

describe("pickPlayableUrl", () => {
  it("prefers the HLS playlist over the player pages", () => {
    expect(
      pickPlayableUrl([
        { label: "HTML", url: "https://x/player.html" },
        { label: "M3U8", url: "https://x/stream.m3u8" },
      ]),
    ).toBe("https://x/stream.m3u8")
  })

  it("is null when no playlist was published", () => {
    expect(pickPlayableUrl([{ label: "HTML", url: "https://x/player.html" }])).toBeNull()
  })

  it("ignores a player page whose query string names the playlist", () => {
    expect(pickPlayableUrl([{ label: "HTML", url: "https://x/player.html?src=stream.m3u8" }])).toBeNull()
  })

  it("still matches a playlist carrying a query string", () => {
    expect(pickPlayableUrl([{ label: "M3U8", url: "https://x/stream.m3u8?token=abc" }])).toBe(
      "https://x/stream.m3u8?token=abc",
    )
  })
})

describe("stripOrigin", () => {
  it("keeps only the path and query of a full URL", () => {
    expect(stripOrigin("https://mirrorr.example/content/f1/player.html?src=stream.m3u8")).toBe(
      "/content/f1/player.html?src=stream.m3u8",
    )
  })

  it("leaves relative and bare-host URLs alone", () => {
    expect(stripOrigin("/content/f1/stream.m3u8")).toBe("/content/f1/stream.m3u8")
    expect(stripOrigin("https://mirrorr.example")).toBe("https://mirrorr.example")
  })
})

describe("SessionUrls", () => {
  it("renders one openable link and one copy button per URL", () => {
    render(<SessionUrls urls={[{ label: "M3U8", url: "https://x/stream.m3u8" }]} />)

    const link = screen.getByRole("link", { name: "/stream.m3u8" })
    expect(link.getAttribute("href")).toBe("https://x/stream.m3u8")
    expect(link.textContent).toContain("/stream.m3u8")
    expect(screen.getByRole("button", { name: "Copy M3U8 URL" })).not.toBeNull()
  })

  it("renders nothing without URLs", () => {
    const { container } = render(<SessionUrls urls={[]} />)
    expect(container.querySelector(".url-list")).toBeNull()
  })
})
