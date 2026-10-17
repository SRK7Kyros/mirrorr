import { useCallback, useRef } from "react"
import type { KeyboardEvent, RefObject } from "react"

/**
 * Tab scoping for inline forms.
 *
 * Tab and Shift+Tab cycle the form's own controls instead of running off into
 * the rail, the header and whatever list sits behind the form — the whole point
 * of the pattern is that a keyboard user can work one form without paging
 * through the app for it. Escape is the documented way out: it hands focus to
 * the next control outside the form, so nothing is ever trapped (WCAG 2.1.2
 * needs an exit the user can find and use).
 *
 * Dialogs need none of this — Radix already traps their focus, and Escape there
 * belongs to the dialog.
 */

const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ")

/**
 * Mirrors what a browser's own Tab does: `display: none` and `visibility:
 * hidden` are skipped, a visually-clipped control (`.sr-only`) is not — it is
 * still a real stop. jsdom has no layout, so a missing `checkVisibility` means
 * "assume visible" and the unit tests keep working on the selector alone.
 */
function isTabbable(el: HTMLElement): boolean {
  const check = (el as HTMLElement & { checkVisibility?: (options?: object) => boolean }).checkVisibility
  if (typeof check !== "function") return true
  return check.call(el, { checkVisibilityCSS: true })
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(isTabbable)
}

/** The first tabbable control after the scope in document order, wrapping to the top of the page. */
function nextOutside(root: HTMLElement): HTMLElement | null {
  const inside = new Set(tabbables(root))
  const outside = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !inside.has(el) && !root.contains(el) && isTabbable(el),
  )
  const following = outside.find(
    (el) => (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  )
  return following ?? outside[0] ?? null
}

export interface FocusScope<T extends HTMLElement> {
  readonly ref: RefObject<T | null>
  readonly onKeyDown: (event: KeyboardEvent<T>) => void
}

/** Attach `ref` and `onKeyDown` to the form (or panel) that should own the Tab cycle. */
export function useFocusScope<T extends HTMLElement>(): FocusScope<T> {
  const ref = useRef<T>(null)

  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    const root = ref.current
    if (root === null) return

    if (event.key === "Escape") {
      nextOutside(root)?.focus()
      return
    }
    if (event.key !== "Tab") return

    const items = tabbables(root)
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) return

    const active = document.activeElement
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  return { ref, onKeyDown }
}
