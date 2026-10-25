import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CapturesTimeline, toCaptureView } from "./captures-timeline"

describe("toCaptureView", () => {
  it("reads a capture record and falls back to the plan's index", () => {
    const view = toCaptureView(
      {
        status: "failed",
        profile_name: "F1 UK",
        engine_name: "yt_dlp_piped",
        resolver_name: "tvnow247",
        attempts: 2,
        reason: "stream never became playable",
      },
      0,
    )

    expect(view).toEqual({
      index: 1,
      status: "failed",
      kind: "profile",
      profile: "F1 UK",
      engine: "yt_dlp_piped",
      resolver: "tvnow247",
      config: null,
      reason: "stream never became playable",
      attempts: 2,
      seconds: null,
      bytes: null,
      merged: false,
    })
  })

  it("names a profile by its id when the record carries no name", () => {
    expect(toCaptureView({ profile_id: 4, status: "completed" }, 1)).toMatchObject({
      index: 2,
      profile: "#4",
      engine: "—",
      resolver: "—",
    })
  })

  it("names a source capture by its resolver and marks it as one", () => {
    expect(
      toCaptureView(
        {
          status: "completed",
          profile_id: null,
          profile_name: "",
          source: "resolver",
          engine_name: "yt_dlp_piped",
          resolver_name: "daddylive",
        },
        1,
      ),
    ).toMatchObject({
      index: 2,
      kind: "source",
      profile: "daddylive",
      resolver: "daddylive",
      config: null,
    })
  })

  it("keeps two rungs of one resolver apart by their config", () => {
    const rung = (channel: string) =>
      toCaptureView(
        {
          status: "failed",
          source: "resolver",
          engine_name: "yt_dlp_piped",
          resolver_name: "daddylive",
          resolver_config: { channel },
        },
        1,
      )

    expect(rung("60").config).toBe("channel=60")
    expect(rung("577").config).toBe("channel=577")
  })

  it("summarises a source's whole config, trimmed like a chain chip", () => {
    expect(
      toCaptureView(
        {
          source: "resolver",
          resolver_name: "daddylive",
          resolver_config: { channel: "60", quality: "", region: null },
        },
        1,
      ).config,
    ).toBe("channel=60")
  })
})

describe("CapturesTimeline", () => {
  it("renders nothing for a single-source session that never fell back", () => {
    const { container } = render(<CapturesTimeline captures={[]} pending={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("marks the fallback's row and the sources still owed", () => {
    const captures = [
      toCaptureView(
        { status: "failed", profile_name: "F1", bytes: null },
        0,
      ),
      toCaptureView(
        { status: "completed", profile_name: "F1 UK", seconds: 3725, bytes: 1_500_000_000, merged: true },
        1,
      ),
    ]

    render(<CapturesTimeline captures={captures} pending={["F1 Italy"]} />)

    expect(screen.getByText("F1")).not.toBeNull()
    expect(screen.getByText("F1 UK")).not.toBeNull()
    expect(screen.getByText("Fallback")).not.toBeNull()
    expect(screen.getByText("In the recording")).not.toBeNull()
    expect(screen.getByText("1:02:05")).not.toBeNull()
    expect(screen.getByText("1.4 GB")).not.toBeNull()
    expect(screen.getByText(/Falls back to F1 Italy/)).not.toBeNull()
  })

  it("names a source once, with its config beside it", () => {
    render(
      <CapturesTimeline
        captures={[
          toCaptureView(
            {
              status: "failed",
              source: "resolver",
              engine_name: "yt_dlp_piped",
              resolver_name: "daddylive",
              resolver_config: { channel: "577" },
            },
            1,
          ),
        ]}
        pending={[]}
      />,
    )

    expect(screen.getAllByText("daddylive")).toHaveLength(1)
    expect(screen.getByText("channel=577")).not.toBeNull()
    expect(screen.getByText("yt_dlp_piped")).not.toBeNull()
    expect(screen.getByText("Source")).not.toBeNull()
  })
})
