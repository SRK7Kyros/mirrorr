import { describe, expect, it, vi } from "vitest"
import { STARTING_STATUSES, STATUS_MAP, getStatusDescriptor, isStarting } from "./status"
import { LIVE_STATUSES } from "./domain/filter-grammar"

describe("getStatusDescriptor", () => {
  it("labels the two stream-readiness states", () => {
    expect(getStatusDescriptor("initializing").label).toBe("Initializing…")
    expect(getStatusDescriptor("stream_pending").label).toBe("Waiting for stream…")
  })

  it("gives both a spinner dot so they read as in-progress, not terminal", () => {
    expect(getStatusDescriptor("initializing").dot).toBe("spinner")
    expect(getStatusDescriptor("stream_pending").dot).toBe("spinner")
  })

  it("allows stop but never delete while starting", () => {
    for (const status of ["initializing", "stream_pending"]) {
      const actions = getStatusDescriptor(status).sessionActions
      expect(actions).toContain("stop")
      expect(actions).not.toContain("delete")
    }
  })

  it("still folds unrecognized statuses onto unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(getStatusDescriptor("not-a-status")).toBe(STATUS_MAP.unknown)
    warn.mockRestore()
  })
})

describe("isStarting", () => {
  it("is true for exactly the two pre-playback states", () => {
    expect(isStarting("initializing")).toBe(true)
    expect(isStarting("stream_pending")).toBe(true)
  })

  it("is false for every other status in the map", () => {
    for (const status of Object.keys(STATUS_MAP)) {
      if (status === "initializing" || status === "stream_pending") continue
      expect(isStarting(status)).toBe(false)
    }
  })
})

describe("STARTING_STATUSES ⊆ LIVE_STATUSES", () => {
  it("keeps every pre-playback state inside the live set", () => {
    for (const status of STARTING_STATUSES) {
      expect(LIVE_STATUSES.has(status)).toBe(true)
    }
  })
})
