/**
 * The platform back seam (spec L498). Android hardware back and the iOS
 * edge-swipe are native events, but their consequence belongs to the web app:
 * an open sheet/drawer closes first (`pushBackInterceptor`), otherwise
 * `router.history.back()` runs when history allows, otherwise the platform
 * default applies (Android backgrounds the app; iOS no-op).
 *
 * The listener is injected rather than imported: the browser build installs
 * `PLATFORM_BACK_EVENT` from `main.tsx` (a window event the app can dispatch
 * today), and todo 29 attaches the real Capacitor `backButton` bridge to the
 * same `handlePlatformBack` — no native plugin is imported by the web build.
 */
export type BackOutcome = "consumed" | "navigated" | "default"

export interface BackNavigationTarget {
  readonly canGoBack: () => boolean
  readonly goBack: () => void
}

/** The browser-side platform-back source; todo 29 dispatches it from Capacitor. */
export const PLATFORM_BACK_EVENT = "mirrorr:back"

let target: BackNavigationTarget | null = null
const interceptors: Array<() => void> = []

export function setBackNavigationTarget(next: BackNavigationTarget | null): void {
  target = next
}

/**
 * Registers the consequence of a back for as long as a sheet/drawer is open.
 * The stack is ordered by registration, so a confirm rendered above a drawer
 * consumes the back before the drawer does. The returned release is idempotent.
 */
export function pushBackInterceptor(interceptor: () => void): () => void {
  interceptors.push(interceptor)
  let active = true

  return () => {
    if (!active) return
    active = false
    const index = interceptors.indexOf(interceptor)
    if (index !== -1) interceptors.splice(index, 1)
  }
}

export function handlePlatformBack(): BackOutcome {
  const top = interceptors[interceptors.length - 1]
  if (top !== undefined) {
    top()
    return "consumed"
  }
  if (target !== null && target.canGoBack()) {
    target.goBack()
    return "navigated"
  }
  return "default"
}

export function installBackNavigation(next: BackNavigationTarget): () => void {
  setBackNavigationTarget(next)
  const listener = (): void => {
    handlePlatformBack()
  }
  window.addEventListener(PLATFORM_BACK_EVENT, listener)

  return () => {
    window.removeEventListener(PLATFORM_BACK_EVENT, listener)
    setBackNavigationTarget(null)
  }
}
