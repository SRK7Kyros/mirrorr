import { AnimatePresence, motion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { createPortal } from "react-dom"
import { useFocusTrap } from "./focus-trap"

export type DialogPresentation = "dialog" | "sheet"

export interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  /** 720px wizard width (D2) vs standard 560. */
  readonly wizard?: boolean
  /**
   * "dialog" (desktop) vs "sheet" (compact bottom sheet). Default resolves
   * from the 639px viewport breakpoint (§6); sheets use the 32×4 handle,
   * sticky header/footer and min-44px rows.
   */
  readonly presentation?: DialogPresentation
}

/** motion `tween-enter`: 0.2s easeOut in, 0.15s easeOut/opacity out (§8). */
const enterTransition = { duration: 0.2, ease: "easeOut" } as const
const exitTransition = { duration: 0.15, ease: "easeIn" } as const

/** Compact viewport check — matchMedia-guarded for jsdom. */
function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(max-width: 639px)").matches
  })

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 639px)")
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
 * Dialog — §4: bg-raised, border-strong, r8, pad24, shadow OVERLAY-only,
 * title 20/600, footer bottom-right (desktop) / full-width stacked (sheet),
 * Esc + backdrop close, focus trap (focus-trap.ts), tween-enter in / 0.15s
 * opacity out with AnimatePresence mode="wait". No box-shadow on content
 * surfaces — this is the overlay layer (§0).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wizard = false,
  presentation,
}: DialogProps) {
  const isCompact = useIsCompactViewport()
  const resolved: DialogPresentation = presentation ?? (isCompact ? "sheet" : "dialog")
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mounted = useMountedPortal(open)

  useFocusTrap(panelRef, open, onClose)

  if (typeof document === "undefined") return null

  const layer = resolved === "sheet" ? "sheet-layer" : "dialog-layer"
  const panel = resolved === "sheet" ? "sheet" : "dialog"

  return createPortal(
    <AnimatePresence>
      {mounted ? (
        <motion.div
          key="dialog-layer"
          className={layer}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exitTransition }}
          transition={enterTransition}
        >
          <div
            className="overlay-backdrop"
            onClick={onClose}
            data-testid="dialog-backdrop"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={wizard ? `${panel} ${panel}--wizard` : panel}
            initial={{ opacity: 0, y: resolved === "sheet" ? 16 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: exitTransition }}
            transition={enterTransition}
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
 * Sheet — compact bottom sheet (§3.3/§4): r `8px 8px 0 0`, 32×4 handle,
 * 48px rows, sticky footer above `--keyboard-inset`, scroll in body only.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mounted = useMountedPortal(open)

  useFocusTrap(panelRef, open, onClose)

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {mounted ? (
        <motion.div
          key="sheet-layer"
          className="sheet-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exitTransition }}
          transition={enterTransition}
        >
          <div className="overlay-backdrop" onClick={onClose} />
          <motion.div
            ref={panelRef as RefObject<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="sheet"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0, transition: exitTransition }}
            transition={enterTransition}
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
