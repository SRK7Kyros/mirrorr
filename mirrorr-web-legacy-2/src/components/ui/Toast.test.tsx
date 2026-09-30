import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Toast, ToastViewport } from "@/components/ui/Toast"
import { clearToasts, showToast, type ToastMessage } from "@/lib/toast"

/**
 * Toast contract (spec L110, L475): bottom-right 320px stack, `bg-overlay` +
 * border, radius 6, icon + message + close; `role="status"`, errors
 * `role="alert"` and sticky until dismissed; 5s auto-dismiss otherwise.
 */

const AUTO_DISMISS_MS = 5000

beforeEach(() => {
  clearToasts()
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => {
    clearToasts()
  })
  vi.useRealTimers()
})

describe("Toast", () => {
  it("renders the placement, surface and close control contract", () => {
    render(<ToastViewport />)
    act(() => {
      showToast("Saved", "info")
    })

    const viewport = screen.getByTestId("toast-viewport")
    expect(viewport.className).toContain("fixed")
    expect(viewport.className).toContain("right-4")
    expect(viewport.className).toContain("bottom-4")
    expect(viewport.className).toContain("flex-col")

    const toast = screen.getByTestId("toast")
    expect(toast.className).toContain("w-80") // 320px
    expect(toast.className).toContain("rounded-surface") // radius 6
    expect(toast.className).toContain("bg-bg-overlay")
    expect(toast.className).toContain("border-border")
    expect(toast.querySelector("svg")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeTruthy()
  })

  it("auto-dismisses a non-error toast after 5s", () => {
    render(<ToastViewport />)
    act(() => {
      showToast("Saved", "info")
    })

    expect(screen.getByTestId("toast").getAttribute("role")).toBe("status")

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS - 1)
    })
    expect(screen.queryByTestId("toast")).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId("toast")).toBeNull()
  })

  it("keeps errors sticky as role=alert until dismissed", () => {
    render(<ToastViewport />)
    act(() => {
      showToast("API unreachable")
    })

    const toast = screen.getByTestId("toast")
    expect(toast.getAttribute("role")).toBe("alert")
    expect(toast.textContent).toContain("API unreachable")

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 12)
    })
    expect(screen.queryByTestId("toast")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByTestId("toast")).toBeNull()
  })

  it("dismisses through the close control without waiting for the timer", () => {
    render(<ToastViewport />)
    act(() => {
      showToast("Saved", "info")
    })

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByTestId("toast")).toBeNull()
  })

  it("renders a single presentational item for the given message", () => {
    const toast: ToastMessage = { id: 1, message: "Hello", tone: "info" }
    const onDismiss = vi.fn()
    render(<Toast toast={toast} onDismiss={onDismiss} />)

    expect(screen.getByTestId("toast").getAttribute("role")).toBe("status")
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  it("renders an action link with its href and keeps the toast open", () => {
    render(<ToastViewport />)
    act(() => {
      showToast("Recording saved", "info", { label: "Open", href: "https://example.com/a.mp4" })
    })

    const action = screen.getByTestId("toast-action")
    expect(action.getAttribute("href")).toBe("https://example.com/a.mp4")
    expect(action.textContent).toBe("Open")
    expect(action.getAttribute("target")).toBe("_blank")
    expect(action.getAttribute("rel")).toBe("noopener noreferrer")

    fireEvent.click(action)
    expect(screen.getByTestId("toast")).not.toBeNull()
  })
})
