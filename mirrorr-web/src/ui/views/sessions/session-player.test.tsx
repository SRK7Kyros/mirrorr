import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SessionPlayer } from "./session-player"

/**
 * The player is third-party surface; what this file owns is the one decision
 * around it (`REC-05`): a media error swaps a dead player for a panel that says
 * so and offers the file, because a dead player and a paused one look alike.
 */
vi.mock("@videojs/react/video", () => ({
  VideoPlayer: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/ui/components/videojs/video/skin", () => ({
  VideoSkin: ({
    children,
    ...rest
  }: {
    readonly children?: React.ReactNode
    readonly className?: string
  }) => <div {...rest}>{children}</div>,
}))
vi.mock("@videojs/react/media/hlsjs-video", () => ({
  HlsJsVideo: (props: Record<string, unknown>) => (
    <video
      data-testid="media"
      onError={props.onError as () => void}
      aria-label={props["aria-label"] as string}
    />
  ),
}))

describe("SessionPlayer", () => {
  it("mounts the media element for a playlist", () => {
    render(<SessionPlayer src="https://x/stream.m3u8" label="Session #7" />)
    expect(screen.getByTestId("media").getAttribute("aria-label")).toBe("Session #7 player")
    expect(screen.queryByText(/could not be played/i)).toBeNull()
  })

  it("states the failure and offers the file when the media errors", () => {
    render(<SessionPlayer src="https://x/stream.m3u8" label="Session #7" />)
    fireEvent.error(screen.getByTestId("media"))

    expect(screen.getByText(/this preview could not be played/i)).not.toBeNull()
    expect(screen.queryByTestId("media")).toBeNull()
    const file = screen.getByRole("link", { name: /open the file/i })
    expect(file.getAttribute("href")).toBe("https://x/stream.m3u8")
  })
})
