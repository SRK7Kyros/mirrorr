/**
 * Remux progress contract (spec L181-L185, L193): the card renders the percent
 * from the latest `session.{id}.remux.progress` frame and swaps to an
 * indeterminate bar once 10s pass without a frame; frames for other sessions
 * are dropped.
 */
import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RemuxProgressCard } from "@/components/sessions/RemuxProgressCard"
import {
  activateRemuxProgress,
  applyRemuxProgressFrame,
  clearRemuxProgress,
} from "@/lib/remux-progress"

afterEach(() => {
  vi.useRealTimers()
  clearRemuxProgress()
})

describe("RemuxProgressCard", () => {
  it("renders the percent from the frame as a determinate bar", () => {
    activateRemuxProgress(7)
    render(<RemuxProgressCard sessionId={7} />)

    act(() => {
      applyRemuxProgressFrame({ session_id: 7, percent: 42.4, eta_seconds: 60, speed: "1.2x" })
    })

    expect(screen.getByTestId("remux-progress-card").getAttribute("data-mode")).toBe("determinate")
    expect(screen.getByTestId("remux-progress-bar").style.width).toBe("42%")
    expect(screen.getByTestId("remux-progress-label").textContent).toContain("42%")
  })

  it("swaps to indeterminate after 10s without frames", () => {
    vi.useFakeTimers()
    activateRemuxProgress(7)
    render(<RemuxProgressCard sessionId={7} />)

    act(() => {
      applyRemuxProgressFrame({ session_id: 7, percent: 10 })
    })
    expect(screen.getByTestId("remux-progress-card").getAttribute("data-mode")).toBe("determinate")

    act(() => {
      vi.advanceTimersByTime(9_999)
    })
    expect(screen.getByTestId("remux-progress-card").getAttribute("data-mode")).toBe("determinate")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    const card = screen.getByTestId("remux-progress-card")
    expect(card.getAttribute("data-mode")).toBe("indeterminate")
    expect(screen.queryByTestId("remux-progress-bar")).toBeNull()
    expect(screen.getByTestId("remux-progress-indeterminate")).toBeTruthy()
  })

  it("drops frames addressed to a session that is not open", () => {
    activateRemuxProgress(7)
    render(<RemuxProgressCard sessionId={7} />)

    act(() => {
      applyRemuxProgressFrame({ session_id: 8, percent: 99 })
    })

    expect(screen.getByTestId("remux-progress-card").getAttribute("data-mode")).toBe("indeterminate")
    expect(screen.getByTestId("remux-progress-label").textContent).toContain("Estimating")
  })
})
