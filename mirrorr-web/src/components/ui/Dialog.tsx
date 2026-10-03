import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { createPortal } from "react-dom"
import { useFocusTrap } from "./focus-trap"
import { tweenEnter } from "./motion-tokens"

export type DialogPresentation = "dialog" | "sheet"

export interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  /** Wizard width (up to 45rem) vs the standard min(32rem, 100vw − 32px). */
  readonly wizard?: boolean
  /**
   * "dialog" (desktop) vs "sheet" (compact bottom sheet). Default resolves
   * from the 767px page-frame breakpoint (§7). Full-screen sheets use radius 0
   * top; the bottom sheet keeps the 8/8/0/0 plate.
   */
  readonly presentation?: DialogPresentation
  /** §8.4: confirm dialogs open with focus on Cancel (safe default). */
  readonly initialFocusRef?: RefObject<HTMLElement | null>
}

/** Compact viewport check — matchMedia-guarded for jsdom. */
function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(max-width: 767px)").matches
  })

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 767px)")
    const onChange = () => setCompact(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return compact
}

function useMountedPortal(open: boolean): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted && open
}

/**
 * Dialog — §6.4: acrylic 0.72/24 over the dark scrim, radius 8, pad 32,
 * max-width min(32rem, 100vw − 32px). Enters on `tween-enter` with
 * AnimatePresence mode="wait" (stable key); the reduced-motion path keeps the
 * opacity drop and drops the y offset. Focus is trapped, Esc closes, focus
 * returns to the trigger (§8.4). Styling flows through the reusable
 * `.acrylic--modal` recipe, so reduced transparency solid-fills it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wizard = false,
  presentation,
  initialFocusRef,
}: DialogProps) {
  const reduced = useReducedMotion()
  const isCompact = useIsCompactViewport()
  const resolved: DialogPresentation = presentation ?? (isCompact ? "sheet" : "dialog")
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mounted = useMountedPortal(open)

  useFocusTrap(panelRef, open && mounted, onClose, initialFocusRef)

  if (typeof document === "undefined") return null

  const offset = resolved === "sheet" ? 16 : 8

  return createPortal(
    <AnimatePresence mode="wait">
      {mounted ? (
        <motion.div
          key="dialog-layer"
          className={resolved === "sheet" ? "sheet-layer" : "dialog-layer"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tweenEnter}
        >
          <div className="overlay-backdrop" onClick={onClose} data-testid="dialog-backdrop" />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={
              resolved === "sheet"
                ? "sheet acrylic acrylic--modal acrylic--r-top"
                : wizard
                  ? "dialog dialog--wizard acrylic acrylic--modal"
                  : "dialog acrylic acrylic--modal"
            }
            initial={{ opacity: 0, y: reduced === true ? 0 : offset }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={tweenEnter}
          >
            {resolved === "sheet" ? <div className="sheet__handle" aria-hidden="true" /> : null}
            <div className={resolved === "sheet" ? "sheet__header" : "dialog__header"}>
              <h2 id={titleId} className={resolved === "sheet" ? "sheet__title" : "dialog__title"}>
                {title}
              </h2>
            </div>
            <div className={resolved === "sheet" ? "sheet__body" : "dialog__body"}>{children}</div>
            {footer !== undefined ? (
              <div className={resolved === "sheet" ? "sheet__footer" : "dialog__footer"}>{footer}</div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

export interface SheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * Sheet — explicit compact bottom sheet (§6.4/§7): 8/8/0/0 plate, 32×4 handle,
 * sticky-feeling footer, scroll in the body only. Same acrylic + focus rules
 * as Dialog.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const reduced = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mounted = useMountedPortal(open)

  useFocusTrap(panelRef, open && mounted, onClose)

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence mode="wait">
      {mounted ? (
        <motion.div
          key="sheet-layer"
          className="sheet-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tweenEnter}
        >
          <div className="overlay-backdrop" onClick={onClose} />
          <motion.div
            ref={panelRef as RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="sheet acrylic acrylic--modal acrylic--r-top"
            initial={{ y: reduced === true ? 0 : 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tweenEnter}
          >
            <div className="sheet__handle" aria-hidden="true" />
            <div className="sheet__header">
              <h2 id={titleId} className="sheet__title">
                {title}
              </h2>
            </div>
            <div className="sheet__body">{children}</div>
            {footer !== undefined ? <div className="sheet__footer">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
