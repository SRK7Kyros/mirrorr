import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { drawerVariants, overlayVariants } from "@/ui/lib/motion"
import { isTopOverlay, popOverlay, pushOverlay } from "@/ui/lib/overlay-stack"
import { IconButton } from "./IconButton"
import { IconX } from "./icons"

export interface DrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly side?: "right" | "left"
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
  /** Stack above an open dialog — for an overlay opened from inside a modal. */
  readonly raised?: boolean
}

/** Slide-over panel — `.drawer` (+ `.drawer-left`). Portalled, Escape closes. */
export function Drawer({
  open,
  onClose,
  title,
  side = "right",
  children,
  footer,
  className,
  raised = false,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const overlayId = useId()
  const titleId = useId()
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    if (!open) return
    pushOverlay(overlayId)
    restoreRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopOverlay(overlayId)) {
        event.preventDefault()
        latest.current()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      popOverlay(overlayId)
      document.removeEventListener("keydown", onKeyDown)
      restoreRef.current?.focus()
    }
  }, [open, overlayId])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="scrim"
          className={cn("scrim drawer-scrim", raised && "drawer-scrim-raised")}
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      {open ? (
        <motion.aside
          key="drawer"
          ref={panelRef}
          className={cn("drawer", side === "left" && "drawer-left", className, raised && "drawer-raised")}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          variants={drawerVariants(side)}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <header className="drawer-head">
            <h2 id={titleId} className="drawer-title">{title}</h2>
            <IconButton label="Close" icon={<IconX size={18} />} onClick={onClose} />
          </header>
          <div className="drawer-body">{children}</div>
          {footer !== undefined ? <footer className="panel-foot">{footer}</footer> : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
