import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { formatDateTime } from "@/api/time"
import { AttemptsTimeline, toAttemptView, type AttemptView } from "./attempts-timeline"

describe("toAttemptView", () => {
  it("reads the backend record shape, which carries no status field", () => {
    const view = toAttemptView(
      {
        index: 2,
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
      status: "active",
      startedAt: "2026-10-09 17:00:00",
      endedAt: null,
      exitCode: null,
      reason: null,
    })
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

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  return {
    index: 1,
    status: "failed",
    startedAt: "2026-10-13T21:09:00",
    endedAt: "2026-10-13T22:04:00",
    exitCode: 1,
    reason: "yt-dlp exited with code 1",
    ...overrides,
  }
}

describe("AttemptsTimeline", () => {
  it("leads with the outcome and how long the attempt ran", () => {
    render(<AttemptsTimeline attempts={[attempt({ index: 7 })]} />)
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
      <AttemptsTimeline
        attempts={[
          attempt({ index: 4, startedAt: "2026-10-13T23:29:00", endedAt: "2026-10-14T00:38:00" }),
        ]}
      />,
    )
    expect(screen.queryByText(formatDateTime("2026-10-13T23:29:00"))).not.toBeNull()
    expect(screen.queryByText(formatDateTime("2026-10-14T00:38:00"))).not.toBeNull()
  })

  it("marks only the newest attempt as latest, and points older ones at their successor", () => {
    render(<AttemptsTimeline attempts={[attempt({ index: 2 }), attempt({ index: 1 })]} />)
    expect(screen.queryByText("Latest")).not.toBeNull()
    expect(screen.queryByText("superseded by #2")).not.toBeNull()
    expect(screen.queryByText("superseded by #1")).toBeNull()
  })

  it("shows a running attempt as running, with no duration yet", () => {
    render(
      <AttemptsTimeline
        attempts={[attempt({ index: 3, status: "active", endedAt: null, exitCode: null, reason: null })]}
      />,
    )
    expect(screen.queryByText("Running")).not.toBeNull()
    expect(screen.queryByText("running")).not.toBeNull()
    expect(screen.queryByText("ran")).toBeNull()
    expect(screen.queryByText("55:00")).toBeNull()
  })

  it("explains the wait before the first attempt starts", () => {
    render(<AttemptsTimeline attempts={[]} />)
    expect(screen.queryByText(/Waiting for the supervisor/)).not.toBeNull()
  })
})
