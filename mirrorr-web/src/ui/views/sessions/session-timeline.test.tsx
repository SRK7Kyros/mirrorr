import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { formatDateTime } from "@/api/time"
import {
  SessionTimeline,
  groupTimeline,
  toAttemptView,
  toCaptureView,
  type AttemptView,
  type CaptureView,
} from "./session-timeline"

describe("toAttemptView", () => {
  it("reads the backend record shape, which carries no status field", () => {
    const view = toAttemptView(
      {
        index: 2,
        capture: 1,
        started_at: "2026-10-09 17:00:00",
        ended_at: null,
        duration_seconds: null,
        returncode: null,
        reason: null,
      },
      1,
    )
    expect(view).toEqual({
      index: 2,
      capture: 1,
      status: "active",
      startedAt: "2026-10-09 17:00:00",
      endedAt: null,
      exitCode: null,
      reason: null,
    })
  })

  it("reads which capture the attempt ran under", () => {
    expect(toAttemptView({ index: 4, capture: 2 }, 3).capture).toBe(2)
  })

  it("puts an attempt written before captures existed on the session's own", () => {
    expect(toAttemptView({ index: 1 }, 0).capture).toBe(1)
  })

  it("marks a finished attempt completed and reads its returncode", () => {
    const view = toAttemptView({ index: 1, started_at: "a", ended_at: "b", returncode: 0 }, 0)
    expect(view.status).toBe("completed")
    expect(view.exitCode).toBe(0)
  })

  it("marks a crash failed and a user stop completed", () => {
    expect(toAttemptView({ ended_at: "b", reason: "engine died" }, 0).status).toBe("failed")
    expect(toAttemptView({ ended_at: "b", reason: "stopped" }, 0).status).toBe("completed")
  })

  it("falls back to the 1-based position when the record has no index", () => {
    expect(toAttemptView({}, 4).index).toBe(5)
  })
})

describe("toCaptureView", () => {
  it("reads a capture record and falls back to the plan's index", () => {
    expect(
      toCaptureView(
        {
          status: "failed",
          profile_name: "F1 UK",
          engine_name: "yt_dlp_piped",
          resolver_name: "tvnow247",
          attempts: 2,
          reason: "stream never became playable",
        },
        0,
      ),
    ).toEqual({
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

function capture(overrides: Partial<CaptureView> = {}): CaptureView {
  return {
    index: 1,
    status: "failed",
    kind: "profile",
    profile: "F1",
    engine: "yt_dlp_piped",
    resolver: "daddylive",
    config: null,
    reason: null,
    attempts: 1,
    seconds: null,
    bytes: null,
    merged: false,
    ...overrides,
  }
}

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  return {
    index: 1,
    capture: 1,
    status: "failed",
    startedAt: "2026-10-13T21:09:00",
    endedAt: "2026-10-13T22:04:00",
    exitCode: 1,
    reason: "yt-dlp exited with code 1",
    ...overrides,
  }
}

describe("groupTimeline", () => {
  it("keeps every capture, in the order the session tried them", () => {
    const groups = groupTimeline(
      [capture({ index: 1 }), capture({ index: 2, profile: "F1 UK" })],
      [],
    )
    expect(groups.map((group) => group.index)).toEqual([1, 2])
    expect(groups[1].capture?.profile).toBe("F1 UK")
  })

  it("puts each attempt under the capture it ran in, newest first", () => {
    const groups = groupTimeline(
      [capture({ index: 1 }), capture({ index: 2 })],
      [
        attempt({ index: 1, capture: 1 }),
        attempt({ index: 2, capture: 1 }),
        attempt({ index: 3, capture: 2 }),
      ],
    )
    expect(groups[0].attempts.map((a) => a.index)).toEqual([2, 1])
    expect(groups[1].attempts.map((a) => a.index)).toEqual([3])
  })

  it("keeps attempts whose capture was never recorded, instead of dropping them", () => {
    const groups = groupTimeline([], [attempt({ index: 1, capture: 1 })])
    expect(groups).toHaveLength(1)
    expect(groups[0].capture).toBeNull()
    expect(groups[0].attempts).toHaveLength(1)
  })
})

describe("SessionTimeline", () => {
  it("explains the wait before the first attempt starts", () => {
    render(<SessionTimeline captures={[]} attempts={[]} pending={[]} />)
    expect(screen.queryByText(/Waiting for the supervisor/)).not.toBeNull()
  })

  it("nests an attempt inside the capture it ran in", () => {
    render(
      <SessionTimeline
        captures={[capture({ index: 1, status: "failed" })]}
        attempts={[attempt({ index: 1, capture: 1 })]}
        pending={[]}
      />,
    )

    const group = screen.getByRole("list", { name: "Attempts in capture 1" })
    expect(within(group).queryByText("#1")).not.toBeNull()
    expect(within(group).queryByText("yt-dlp exited with code 1")).not.toBeNull()
    // The capture's own row is outside the attempt list.
    expect(screen.getByText("F1")).not.toBeNull()
    expect(screen.queryByText(/yt-dlp exited with code 1/)).not.toBeNull()
  })

  it("marks the fallback's capture, its media and the sources still owed", () => {
    const captures = [
      toCaptureView({ status: "failed", profile_name: "F1", attempts: 1 }, 0),
      toCaptureView(
        { status: "completed", profile_name: "F1 UK", seconds: 3725, bytes: 1_500_000_000, merged: true },
        1,
      ),
    ]

    render(<SessionTimeline captures={captures} attempts={[]} pending={["F1 Italy"]} />)

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
      <SessionTimeline
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
        attempts={[]}
        pending={[]}
      />,
    )

    expect(screen.getAllByText("daddylive")).toHaveLength(1)
    expect(screen.getByText("channel=577")).not.toBeNull()
    expect(screen.getByText("yt_dlp_piped")).not.toBeNull()
    expect(screen.getByText("Source")).not.toBeNull()
  })

  it("leads with the outcome and how long the attempt ran", () => {
    render(
      <SessionTimeline captures={[]} attempts={[attempt({ index: 7 })]} pending={[]} />,
    )
    expect(screen.queryByText("#7")).not.toBeNull()
    expect(screen.queryByText("Failed")).not.toBeNull()
    expect(screen.queryByText("Latest")).not.toBeNull()
    expect(screen.queryByText("yt-dlp exited with code 1")).not.toBeNull()
    expect(screen.queryByText("55:00")).not.toBeNull()
    expect(screen.queryByText("exit 1")).not.toBeNull()
    expect(screen.queryByText("started")).not.toBeNull()
    expect(screen.queryByText("ended")).not.toBeNull()
    expect(screen.queryByText(formatDateTime("2026-10-13T21:09:00"))).not.toBeNull()
    // Same day, so the end line drops the day rather than repeating it.
    expect(screen.queryByText(formatDateTime("2026-10-13T22:04:00"))).toBeNull()
  })

  it("keeps the day on the end line when an attempt crosses midnight", () => {
    render(
      <SessionTimeline
        captures={[]}
        attempts={[
          attempt({ index: 4, startedAt: "2026-10-13T23:29:00", endedAt: "2026-10-14T00:38:00" }),
        ]}
        pending={[]}
      />,
    )
    expect(screen.queryByText(formatDateTime("2026-10-13T23:29:00"))).not.toBeNull()
    expect(screen.queryByText(formatDateTime("2026-10-14T00:38:00"))).not.toBeNull()
  })

  it("marks only the newest attempt as latest, and points older ones at their successor", () => {
    render(<SessionTimeline captures={[]} attempts={[attempt({ index: 2 }), attempt({ index: 1 })]} pending={[]} />)
    expect(screen.queryByText("Latest")).not.toBeNull()
    expect(screen.queryByText("superseded by #2")).not.toBeNull()
    expect(screen.queryByText("superseded by #1")).toBeNull()
  })

  it("chains supersession across a handover to the next capture", () => {
    render(
      <SessionTimeline
        captures={[capture({ index: 1 }), capture({ index: 2, profile: "F1 UK", status: "active" })]}
        attempts={[
          attempt({ index: 1, capture: 1 }),
          attempt({ index: 2, capture: 2, status: "active", endedAt: null, exitCode: null, reason: null }),
        ]}
        pending={[]}
      />,
    )
    expect(screen.queryByText("superseded by #2")).not.toBeNull()
    // Only the newest attempt of the whole run is the latest one.
    expect(screen.getAllByText("Latest")).toHaveLength(1)
  })

  it("shows a running attempt as running, with no duration yet", () => {
    render(
      <SessionTimeline
        captures={[]}
        attempts={[attempt({ index: 3, status: "active", endedAt: null, exitCode: null, reason: null })]}
        pending={[]}
      />,
    )
    expect(screen.queryByText("Running")).not.toBeNull()
    expect(screen.queryByText("running")).not.toBeNull()
    expect(screen.queryByText("ran")).toBeNull()
    expect(screen.queryByText("55:00")).toBeNull()
  })

  it("says a capture it has not reached yet has no attempt", () => {
    render(
      <SessionTimeline
        captures={[capture({ index: 1, attempts: 1 }), capture({ index: 2, attempts: 0, status: "active" })]}
        attempts={[attempt({ index: 1 })]}
        pending={[]}
      />,
    )
    expect(screen.queryByText("No attempt recorded for this capture.")).not.toBeNull()
  })
})
