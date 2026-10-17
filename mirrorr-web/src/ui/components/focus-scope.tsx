import { useCallback, useRef } from "react"
import type { KeyboardEvent, RefObject } from "react"
import { isTabStop, tabStops } from "./tab-stops"

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
 * The controls are the ones the tab-stop map marks (see `tab-stops.ts`), so the
 * scope cannot drift from the rest of the app: a control that is not a stop
 * anywhere is not one inside a form either.
 *
 * Dialogs need none of this — Radix already traps their focus, and Escape there
 * belongs to the dialog.
 */

const OUTSIDE = "[tabindex], .tab-stop, a[href], button, input, select, textarea, summary"

/** The first stop after the scope in document order, wrapping to the top of the page. */
function nextOutside(root: HTMLElement): HTMLElement | null {
  const inside = new Set(tabStops(root))
  const outside = Array.from(document.querySelectorAll<HTMLElement>(OUTSIDE)).filter(
    (el) => isTabStop(el) && !inside.has(el) && !root.contains(el),
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

    const items = tabStops(root)
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
