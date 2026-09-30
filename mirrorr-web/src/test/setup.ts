import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jsdom does not implement scrolling; TanStack Router calls this on navigation.
window.scrollTo = () => undefined

// Vitest runs without globals, so React Testing Library cannot auto-register
// its cleanup hook; unmount every rendered tree between tests explicitly.
afterEach(() => {
  cleanup()
})
