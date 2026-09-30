/**
 * Todo 21 acceptance (spec L171): "resume WS on next successful poll" after the
 * 12-attempt ceiling. The installer subscribes to the query cache; while the
 * realtime status is `offline`, the first successful (idle, non-stale) entity
 * poll resumes the manager exactly once, so a 15s poll can bring the socket
 * back without a manual Retry. Liveness probes never trigger a resume.
 */
import { describe, expect, it, vi } from "vitest"
import { installRealtimeResume, type RealtimeResumeCacheEvent } from "@/lib/realtime-resume"
import type { RealtimeStatus } from "@/lib/realtime-status"

interface HarnessQueryState {
  readonly status: string
  readonly fetchStatus: string
  readonly dataUpdatedAt: number
}

interface HarnessOptions {
  readonly status?: RealtimeStatus
  readonly now?: number
}

function makeHarness(options: HarnessOptions = {}) {
  const cacheListeners = new Set<(event: RealtimeResumeCacheEvent) => void>()
  const statusListeners = new Set<() => void>()
  let status: RealtimeStatus = options.status ?? "live"
  let now = options.now ?? 0
  const resume = vi.fn()

  const unsubscribe = installRealtimeResume({
    queryCache: {
      subscribe: (listener) => {
        cacheListeners.add(listener)
        return () => cacheListeners.delete(listener)
      },
    },
    subscribeStatus: (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    getStatus: () => status,
    resume,
    now: () => now,
  })

  return {
    resume,
    unsubscribe,
    setStatus(next: RealtimeStatus) {
      status = next
      for (const listener of statusListeners) listener()
    },
    setNow(value: number) {
      now = value
    },
    emitUpdate(
      queryKey: readonly unknown[],
      dataUpdatedAt: number,
      state: Partial<HarnessQueryState> = {},
    ) {
      const event: RealtimeResumeCacheEvent = {
        type: "updated",
        query: {
          queryKey,
          state: { status: "success", fetchStatus: "idle", dataUpdatedAt, ...state },
        },
      }
      for (const listener of cacheListeners) listener(event)
    },
  }
}

describe("installRealtimeResume", () => {
  it("resumes exactly once for the first successful poll while offline", () => {
    const harness = makeHarness({ status: "live", now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 6_000)

    expect(harness.resume).toHaveBeenCalledTimes(1)
    harness.unsubscribe()
  })

  it("does not resume twice for the same poll result", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 6_000)
    harness.emitUpdate(["sessions", {}], 6_000)
    harness.emitUpdate(["sessions", {}], 6_000)

    expect(harness.resume).toHaveBeenCalledTimes(1)
    harness.unsubscribe()
  })

  it("resumes again on the next poll result", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 6_000)
    harness.emitUpdate(["sessions", {}], 21_000)

    expect(harness.resume).toHaveBeenCalledTimes(2)
    harness.unsubscribe()
  })

  it("resumes from independent entity queries while offline", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 6_000)
    harness.emitUpdate(["recordings", {}], 6_100)
    harness.emitUpdate(["session", 5], 6_200)

    expect(harness.resume).toHaveBeenCalledTimes(3)
    harness.unsubscribe()
  })

  it("never resumes on liveness probes (health, auth)", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["health"], 6_000)
    harness.emitUpdate(["auth", "me"], 6_100)
    harness.emitUpdate(["auth", "status"], 6_200)

    expect(harness.resume).not.toHaveBeenCalled()
    harness.unsubscribe()
  })

  it("ignores successful updates while the socket is not offline", () => {
    const harness = makeHarness({ status: "live", now: 0 })
    harness.setStatus("reconnecting")

    harness.emitUpdate(["sessions", {}], 6_000)

    expect(harness.resume).not.toHaveBeenCalled()
    harness.unsubscribe()
  })

  it("ignores in-flight and failed updates", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 6_000, { fetchStatus: "fetching" })
    harness.emitUpdate(["recordings", {}], 6_100, { status: "error" })
    harness.emitUpdate(["autoruns", {}], 6_200, { status: "pending" })

    expect(harness.resume).not.toHaveBeenCalled()
    harness.unsubscribe()
  })

  it("ignores data that was already stale when the outage started", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")

    harness.emitUpdate(["sessions", {}], 4_999)

    expect(harness.resume).not.toHaveBeenCalled()
    harness.unsubscribe()
  })

  it("resumes again after a full recovery / new outage episode", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")
    harness.emitUpdate(["sessions", {}], 6_000)
    expect(harness.resume).toHaveBeenCalledTimes(1)

    harness.setStatus("live")
    harness.setStatus("reconnecting")
    harness.emitUpdate(["sessions", {}], 7_000)
    expect(harness.resume).toHaveBeenCalledTimes(1)

    harness.setNow(30_000)
    harness.setStatus("offline")
    harness.emitUpdate(["sessions", {}], 31_000)
    expect(harness.resume).toHaveBeenCalledTimes(2)
    harness.unsubscribe()
  })

  it("stops listening after cleanup", () => {
    const harness = makeHarness({ now: 0 })
    harness.setNow(5_000)
    harness.setStatus("offline")
    harness.unsubscribe()

    harness.emitUpdate(["sessions", {}], 6_000)

    expect(harness.resume).not.toHaveBeenCalled()
  })
})
