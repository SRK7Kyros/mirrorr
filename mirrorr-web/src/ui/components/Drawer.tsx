import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { drawerVariants, overlayVariants } from "@/ui/lib/motion"
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

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

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
          aria-label={typeof title === "string" ? title : undefined}
          tabIndex={-1}
          variants={drawerVariants(side)}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <header className="drawer-head">
            <h2 className="drawer-title">{title}</h2>
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
