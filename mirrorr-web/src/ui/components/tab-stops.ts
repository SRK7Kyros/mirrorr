import { useLayoutEffect } from "react"

/**
 * One map of the surfaces a keyboard user may land on.
 *
 * `tab-stop` marks an element as a permitted stop. A link (`a[href]`) is one by
 * nature — navigation is the thing a keyboard user must always be able to reach
 * — so it needs no class and takes `tab-skip` to leave the map. `tab-skip` marks
 * any other control — or a whole region — that must never be a stop; the
 * dialog's and the drawer's × are the case that needs it, because Escape already
 * closes both. `useTabStopMap` writes the map onto the DOM: every other natively
 * focusable element gets `tabindex="-1"`, so it leaves the browser's Tab order
 * without losing clicks, hover or assistive technology, and a marked element
 * with no native focus gets `tabindex="0"`.
 *
 * An element that declares its own `tabindex` is left alone. That is how the
 * roving widgets keep their single stop (`Segmented`, the access catalog) and
 * how Radix's focus guards keep the modal trap working.
 */
export const TAB_STOP_CLASS = "tab-stop"
export const TAB_SKIP_CLASS = "tab-skip"

const NATIVE_FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable=true]",
].join(", ")

const CANDIDATE = `${NATIVE_FOCUSABLE}, [tabindex], .${TAB_STOP_CLASS}`

function isVisible(element: HTMLElement): boolean {
  const check = (element as HTMLElement & { checkVisibility?: (options?: object) => boolean })
    .checkVisibility
  if (typeof check !== "function") return true
  return check.call(element, { checkVisibilityCSS: true })
}

function isLink(element: HTMLElement): boolean {
  return element.tagName === "A" && element.hasAttribute("href")
}

/**
 * A stop is either marked, a link, or a widget that declared the stop itself (a
 * roving item), and it has to be reachable right now: enabled and rendered.
 * `.sr-only` controls count — a visually clipped input is still a real stop.
 */
export function isTabStop(element: HTMLElement): boolean {
  if (element.closest(`.${TAB_SKIP_CLASS}`) !== null) return false
  if (element.tabIndex < 0) return false
  if (!element.classList.contains(TAB_STOP_CLASS) && !element.hasAttribute("tabindex") && !isLink(element)) {
    return false
  }
  if ((element as { disabled?: boolean }).disabled === true) return false
  return isVisible(element)
}

/** The stops inside a scope, in document order. */
export function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATE)).filter(isTabStop)
}

/** Writes the map onto the DOM. Idempotent — safe to run on every mutation. */
export function syncTabStops(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>(NATIVE_FOCUSABLE)) {
    if (element.closest(`.${TAB_SKIP_CLASS}`) !== null) {
      if (element.getAttribute("tabindex") !== "-1") element.setAttribute("tabindex", "-1")
      continue
    }
    if (element.hasAttribute("tabindex")) continue
    element.setAttribute(
      "tabindex",
      element.classList.contains(TAB_STOP_CLASS) || isLink(element) ? "0" : "-1",
    )
  }
  for (const element of root.querySelectorAll<HTMLElement>(`.${TAB_STOP_CLASS}`)) {
    if (element.hasAttribute("tabindex")) continue
    if (element.closest(`.${TAB_SKIP_CLASS}`) !== null) continue
    element.setAttribute("tabindex", "0")
  }
}

/**
 * Mounted once per entry — the map covers the whole document, including the
 * portals Radix renders on `body`. Re-runs coalesced to one pass per frame, so a
 * list rendering a hundred rows costs one sweep, not a hundred.
 */
export function useTabStopMap(): void {
  useLayoutEffect(() => {
    const root = document.body
    syncTabStops(root)
    // Synchronously, not on the next frame: a commit that adds a control must
    // stamp it before any Tab press can reach it.
    const observer = new MutationObserver(() => syncTabStops(root))
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
}

/** The hook as a node, so an entry can mount the map without a second wrapper. */
export function TabStopMap(): null {
  useTabStopMap()
  return null
}
