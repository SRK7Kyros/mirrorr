import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jsdom does not implement scrolling; TanStack Router calls this on navigation.
window.scrollTo = () => undefined

// jsdom has no matchMedia; the compact-shell breakpoint seam reads it. Tests
// that need a specific answer re-stub it with vi.stubGlobal.
if (typeof window.matchMedia !== "function") {
  const mediaQueryList = {
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }
  window.matchMedia = () => mediaQueryList as MediaQueryList
}

// Vitest runs without globals, so React Testing Library cannot auto-register
// its cleanup hook; unmount every rendered tree between tests explicitly.
afterEach(() => {
  cleanup()
})
