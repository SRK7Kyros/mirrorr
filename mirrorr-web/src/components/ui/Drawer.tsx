import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useId, useRef } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { IconX } from "./icons"
import { useFocusTrap } from "./focus-trap"
import { SkeletonList } from "./Skeleton"
import { tweenEnter } from "./motion-tokens"

export interface DrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  /** §6.4 loading: body renders skeletons while the payload resolves. */
  readonly loading?: boolean
  /** §6.4 error: inline error panel with a Retry affordance. */
  readonly error?: ReactNode
  /** §6.4 empty: "Nothing here yet." state. */
  readonly empty?: ReactNode
  /** Slide-in side — left is offered for RTL/experimental shells. */
  readonly side?: "right" | "left"
}

/**
 * Drawer — §6.4: acrylic 0.72/24 sliding from the right, radius 8 on the
 * inner edge, its own scrollable body. Close glyph is a chip. Focus is trapped
 * and Esc closes (§8.4); footer actions pin to the bottom. Enter/exit use
 * `tween-enter` (opacity-first, quiet exit).
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  loading = false,
  error,
  empty,
  side = "right",
}: DrawerProps) {
  const reduced = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useFocusTrap(panelRef, open, onClose)

  if (typeof document === "undefined") return null

  const offscreen = side === "right" ? "100%" : "-100%"

  return createPortal(
    <AnimatePresence mode="wait">
      {open ? (
        <motion.div
          key="drawer-layer"
          className="drawer-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={tweenEnter}
        >
          <div className="overlay-backdrop" onClick={onClose} data-testid="drawer-backdrop" />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={
              side === "right"
                ? "drawer acrylic acrylic--modal drawer--right"
                : "drawer acrylic acrylic--modal drawer--left"
            }
            initial={{ x: reduced === true ? 0 : offscreen, opacity: reduced === true ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tweenEnter}
          >
            <header className="drawer__header">
              <h2 id={titleId} className="drawer__title">
                {title}
              </h2>
              <button type="button" className="drawer__close" aria-label="Close panel" onClick={onClose}>
                <IconX size={16} />
              </button>
            </header>
            <div className="drawer__body">
              {loading ? <SkeletonList rows={6} /> : (error ?? empty ?? children)}
            </div>
            {footer !== undefined ? <div className="drawer__footer">{footer}</div> : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
