import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { SessionPreview } from "./session-preview"

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
}))

vi.mock("hls.js", () => ({
  default: Object.assign(
    class {
      static isSupported(): boolean {
        return true
      }
      loadSource = hls.loadSource
      attachMedia = hls.attachMedia
      destroy = hls.destroy
      on = hls.on
    },
    { Events: { MANIFEST_PARSED: "MANIFEST_PARSED" } },
  ),
}))

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  vi.clearAllMocks()
})

describe("SessionPreview", () => {
  it("holds no player at rest", () => {
    render(<SessionPreview src="https://x/stream.m3u8" load={false} active={false} loop />)
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it("attaches on scroll-in and shows the first frame without playing", () => {
    const { container } = render(
      <SessionPreview src="https://x/stream.m3u8" load active={false} loop />,
    )
    expect(hls.loadSource).toHaveBeenCalledWith("https://x/stream.m3u8")
    expect(hls.attachMedia).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(container.querySelector(".session-preview")?.getAttribute("data-loaded")).toBe("true")
  })

  it("plays once the manifest is parsed while active", () => {
    render(<SessionPreview src="https://x/stream.m3u8" load active loop />)
    const parsed = hls.on.mock.calls.find(([event]) => event === "MANIFEST_PARSED")?.[1] as
      | (() => void)
      | undefined
    expect(parsed).toBeDefined()
    parsed?.()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it("tears the player down when it leaves", () => {
    const { unmount } = render(<SessionPreview src="https://x/stream.m3u8" load active loop />)
    unmount()
    expect(hls.destroy).toHaveBeenCalledTimes(1)
  })

  it("does nothing without a playlist", () => {
    render(<SessionPreview src={null} load active loop />)
    expect(hls.loadSource).not.toHaveBeenCalled()
  })
})
