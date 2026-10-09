import { describe, expect, it } from "vitest"
import { toAttemptView } from "./session-detail"

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
