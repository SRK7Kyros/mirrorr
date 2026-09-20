/**
 * Toast store contract additions: an optional action (the V7 `recording.created`
 * toast carries "Open" — spec L321) on top of the existing 5s/sticky rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearToasts, getToasts, showToast } from "@/lib/toast"

beforeEach(() => {
  vi.useFakeTimers()
  clearToasts()
})

afterEach(() => {
  clearToasts()
  vi.useRealTimers()
})

describe("toast actions", () => {
  it("stores an action with the message", () => {
    showToast("Recording saved", "info", { label: "Open", href: "https://example.com/content/a.mp4" })

    const toast = getToasts()[0]
    expect(toast?.message).toBe("Recording saved")
    expect(toast?.tone).toBe("info")
    expect(toast?.action).toEqual({ label: "Open", href: "https://example.com/content/a.mp4" })
  })

  it("keeps plain toasts action-free", () => {
    showToast("Saved", "info")
    expect(getToasts()[0]?.action).toBeUndefined()
  })

  it("still auto-dismisses an info toast carrying an action", () => {
    showToast("Recording saved", "info", { label: "Open", href: "/x" })
    vi.advanceTimersByTime(5000)
    expect(getToasts()).toHaveLength(0)
  })

  it("keeps an error toast with an action sticky", () => {
    showToast("Recording saved", "error", { label: "Open", href: "/x" })
    vi.advanceTimersByTime(60_000)
    expect(getToasts()).toHaveLength(1)
  })
})
