import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useCountdownTick, useLiveDurationTick } from "@/hooks/use-tick"
import { COUNTDOWN_TICK_MS, LIVE_DURATION_TICK_MS } from "@/lib/time"

/**
 * Tick cadences (`docs/web-frontend-spec.md` L231-L232): autorun countdowns
 * recompute on a 10s tick (never seconds precision); a live session duration
 * ticks every second ONLY on an open session detail view. The 1s cadence must
 * not be reachable outside `useLiveDurationTick(enabled)`.
 */

const EPOCH = new Date("2026-07-15T12:00:00Z")

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("useCountdownTick", () => {
  it("ticks on the 10s cadence and never on a 1s cadence", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    const intervalSpy = vi.spyOn(window, "setInterval")

    const { result } = renderHook(() => useCountdownTick())
    const startedAt = result.current.getTime()

    act(() => {
      vi.advanceTimersByTime(LIVE_DURATION_TICK_MS)
    })
    expect(result.current.getTime()).toBe(startedAt)

    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_TICK_MS - LIVE_DURATION_TICK_MS)
    })
    expect(result.current.getTime()).toBe(startedAt + COUNTDOWN_TICK_MS)

    const delays = intervalSpy.mock.calls.map(([, delay]) => delay)
    expect(delays).toContain(COUNTDOWN_TICK_MS)
    expect(delays).not.toContain(LIVE_DURATION_TICK_MS)
  })
})

describe("useLiveDurationTick", () => {
  it("ticks every second while enabled (an open session detail)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)

    const { result } = renderHook(() => useLiveDurationTick(true))
    const startedAt = result.current.getTime()

    act(() => {
      vi.advanceTimersByTime(LIVE_DURATION_TICK_MS)
    })
    expect(result.current.getTime()).toBe(startedAt + LIVE_DURATION_TICK_MS)
  })

  it("schedules no 1s interval while disabled (everywhere else)", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    const intervalSpy = vi.spyOn(window, "setInterval")

    const { result } = renderHook(() => useLiveDurationTick(false))
    const startedAt = result.current.getTime()

    act(() => {
      vi.advanceTimersByTime(10 * LIVE_DURATION_TICK_MS)
    })

    expect(result.current.getTime()).toBe(startedAt)
    expect(intervalSpy.mock.calls.map(([, delay]) => delay)).not.toContain(LIVE_DURATION_TICK_MS)
  })

  it("clears its interval on unmount", () => {
    vi.useFakeTimers()
    vi.setSystemTime(EPOCH)
    const intervalSpy = vi.spyOn(window, "setInterval")
    const clearSpy = vi.spyOn(window, "clearInterval")

    const { unmount } = renderHook(() => useLiveDurationTick(true))
    const intervalId = intervalSpy.mock.results[0]?.value

    unmount()

    expect(clearSpy).toHaveBeenCalledWith(intervalId)
  })
})
