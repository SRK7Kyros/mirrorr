import { describe, expect, it } from "vitest"
import { deriveRunState } from "./run-state"

describe("deriveRunState", () => {
  it("maps a live capture to one state with its panels open", () => {
    const run = deriveRunState({ status: "recording", recording: true, hasRecording: true })
    expect(run.state).toBe("recording")
    expect(run.hero).toBe("elapsed")
    expect(run.verb).toBe("stop")
    expect(run.panels).toEqual({ sources: true, recording: true, live: true })
  })

  it("keeps a starting run in the live family so the header and panels agree", () => {
    const run = deriveRunState({ status: "stream_pending" })
    expect(run.state).toBe("starting")
    expect(run.hero).toBe("elapsed")
    expect(run.panels.live).toBe(true)
  })

  it("shows no live panel on a terminal run", () => {
    const run = deriveRunState({ status: "completed", hasRecording: true })
    expect(run.state).toBe("completed")
    expect(run.panels.live).toBe(false)
    expect(run.panels.recording).toBe(true)
    expect(run.verb).toBe("open-recording")
  })

  it("offers retry, not open, when a failed run produced no file", () => {
    const run = deriveRunState({ status: "failed", hasRecording: false })
    expect(run.hero).toBe("reason")
    expect(run.verb).toBe("retry")
    expect(run.attention).toBe(true)
  })

  it("treats a passed one-shot schedule as retired, not Scheduled", () => {
    const run = deriveRunState({ status: "scheduled", retired: true })
    expect(run.state).toBe("retired")
    expect(run.label).toBe("Retired")
    expect(run.tone).toBe("neutral")
    expect(run.hero).toBe("duration")
  })

  it("raises attention for a flagged schedule even while it is still Scheduled", () => {
    const run = deriveRunState({ status: "scheduled", issue: "profile-deleted" })
    expect(run.state).toBe("scheduled")
    expect(run.attention).toBe(true)
    expect(run.verb).toBe("edit-schedule")
  })

  it("never invents a label for an unknown status", () => {
    const run = deriveRunState({ status: "exploded" })
    expect(run.state).toBe("unknown")
    expect(run.label).toBe("Unknown")
    expect(run.verb).toBeNull()
  })
})
