import { useEffect, useRef } from "react"
import type { RefObject } from "react"

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal keyboard contract (§7): focus moves into the container on open,
 * Tab/Shift+Tab cycle within it, Escape closes, focus returns to the
 * previously focused element on close. `onClose` is read through a ref so
 * callers may pass inline closures without re-running the trap.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (container === null) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      )

    const preferred = initialFocusRef?.current ?? null
    ;(preferred ?? focusables()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return

      const elements = focusables()
      if (elements.length === 0) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener("keydown", onKeyDown)
    return () => {
      container.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus()
    }
  }, [active, containerRef])
}
