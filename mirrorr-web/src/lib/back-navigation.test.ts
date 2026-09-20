/**
 * Todo 24 back semantics (spec L498): Android hardware back and the iOS
 * edge-swipe call `router.history.back()` when history allows; an open
 * sheet/drawer registers an interceptor and consumes the first back. The
 * platform listener is injectable so the browser build can exercise the seam
 * now and todo 29 can wire the real Capacitor bridge to the same function.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  handlePlatformBack,
  installBackNavigation,
  PLATFORM_BACK_EVENT,
  pushBackInterceptor,
  setBackNavigationTarget,
  type BackNavigationTarget,
} from "@/lib/back-navigation"

function stubTarget(canGoBack: boolean) {
  const goBack = vi.fn()
  const target: BackNavigationTarget = { canGoBack: () => canGoBack, goBack }
  setBackNavigationTarget(target)
  return goBack
}

afterEach(() => {
  setBackNavigationTarget(null)
})

describe("handlePlatformBack", () => {
  it("consumes the back and leaves history alone while a sheet is open", () => {
    const goBack = stubTarget(true)
    const close = vi.fn()
    const release = pushBackInterceptor(close)

    expect(handlePlatformBack()).toBe("consumed")
    expect(close).toHaveBeenCalledTimes(1)
    expect(goBack).not.toHaveBeenCalled()

    release()
  })

  it("gives the back to the topmost interceptor only (a confirm inside a sheet)", () => {
    const closeSheet = vi.fn()
    const closeConfirm = vi.fn()
    const releaseSheet = pushBackInterceptor(closeSheet)
    const releaseConfirm = pushBackInterceptor(closeConfirm)

    expect(handlePlatformBack()).toBe("consumed")
    expect(closeConfirm).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()

    releaseConfirm()
    expect(handlePlatformBack()).toBe("consumed")
    expect(closeSheet).toHaveBeenCalledTimes(1)

    releaseSheet()
  })

  it("navigates back once every sheet has released", () => {
    const goBack = stubTarget(true)
    const close = vi.fn()
    const release = pushBackInterceptor(close)

    expect(handlePlatformBack()).toBe("consumed")
    release()

    expect(handlePlatformBack()).toBe("navigated")
    expect(goBack).toHaveBeenCalledTimes(1)
  })

  it("falls through to the platform default when history cannot go back", () => {
    const goBack = stubTarget(false)

    expect(handlePlatformBack()).toBe("default")
    expect(goBack).not.toHaveBeenCalled()
  })

  it("returns the platform default when no target is installed", () => {
    expect(handlePlatformBack()).toBe("default")
  })

  it("ignores a released interceptor and is idempotent on double release", () => {
    const goBack = stubTarget(true)
    const close = vi.fn()
    const release = pushBackInterceptor(close)

    release()
    release()

    expect(handlePlatformBack()).toBe("navigated")
    expect(close).not.toHaveBeenCalled()
    expect(goBack).toHaveBeenCalledTimes(1)
  })
})

describe("installBackNavigation", () => {
  it("routes the injected platform source to the router history seam", () => {
    const goBack = vi.fn()
    const uninstall = installBackNavigation({ canGoBack: () => true, goBack })

    window.dispatchEvent(new Event(PLATFORM_BACK_EVENT))
    expect(goBack).toHaveBeenCalledTimes(1)

    uninstall()
    window.dispatchEvent(new Event(PLATFORM_BACK_EVENT))
    expect(goBack).toHaveBeenCalledTimes(1)
  })

  it("lets an open sheet consume the platform event first", () => {
    const goBack = vi.fn()
    const uninstall = installBackNavigation({ canGoBack: () => true, goBack })
    const close = vi.fn()
    const release = pushBackInterceptor(close)

    window.dispatchEvent(new Event(PLATFORM_BACK_EVENT))
    expect(close).toHaveBeenCalledTimes(1)
    expect(goBack).not.toHaveBeenCalled()

    release()
    window.dispatchEvent(new Event(PLATFORM_BACK_EVENT))
    expect(goBack).toHaveBeenCalledTimes(1)

    uninstall()
  })

  it("clears the target on uninstall", () => {
    const uninstall = installBackNavigation({ canGoBack: () => true, goBack: vi.fn() })
    uninstall()
    expect(handlePlatformBack()).toBe("default")
  })
})
