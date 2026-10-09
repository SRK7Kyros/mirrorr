import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { SessionPreview } from "./session-preview"

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock("hls.js", () => ({
  default: class {
    static isSupported(): boolean {
      return true
    }
    loadSource = hls.loadSource
    attachMedia = hls.attachMedia
    destroy = hls.destroy
  },
}))

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  vi.clearAllMocks()
})

describe("SessionPreview", () => {
  it("holds no player at rest", () => {
    render(<SessionPreview src="https://x/stream.m3u8" active={false} loop />)
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it("attaches hls.js and autoplays while active", () => {
    render(<SessionPreview src="https://x/stream.m3u8" active loop />)
    expect(hls.loadSource).toHaveBeenCalledWith("https://x/stream.m3u8")
    expect(hls.attachMedia).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it("tears the player down when it leaves", () => {
    const { unmount } = render(<SessionPreview src="https://x/stream.m3u8" active loop />)
    unmount()
    expect(hls.destroy).toHaveBeenCalledTimes(1)
  })

  it("does nothing without a playlist", () => {
    render(<SessionPreview src={null} active loop />)
    expect(hls.loadSource).not.toHaveBeenCalled()
  })
})
