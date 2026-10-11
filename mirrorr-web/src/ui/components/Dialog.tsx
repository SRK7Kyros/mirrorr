import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { dialogVariants, overlayVariants } from "@/ui/lib/motion"
import { isTopOverlay, popOverlay, pushOverlay } from "@/ui/lib/overlay-stack"
import { IconButton } from "./IconButton"
import { IconX } from "./icons"

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly size?: "md" | "lg"
  readonly icon?: ReactNode
  readonly children?: ReactNode
  readonly footer?: ReactNode
  /** Block Escape / scrim close while a submit is in flight. */
  readonly busy?: boolean
}

/**
 * Modal dialog — `.scrim` + `.dialog`. Portalled to `body`, traps Tab, closes
 * on Escape or scrim click (unless `busy`), and restores focus on unmount.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  icon,
  children,
  footer,
  busy = false,
}: DialogProps) {
  const titleId = useId()
  const descId = useId()
  const overlayId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const latest = useRef({ onClose, busy })
  useEffect(() => {
    latest.current = { onClose, busy }
  })

  useEffect(() => {
    if (!open) return
    pushOverlay(overlayId)
    restoreRef.current = document.activeElement as HTMLElement | null
    const node = dialogRef.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !latest.current.busy && isTopOverlay(overlayId)) {
        event.preventDefault()
        latest.current.onClose()
        return
      }
      if (event.key !== "Tab" || node === null) return
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault()
        firstEl.focus()
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
          className="scrim"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={() => {
            if (!busy) onClose()
          }}
          aria-hidden="true"
        />
      ) : null}
      {open ? (
        <motion.div
          key="dialog"
          ref={dialogRef}
          className={cn("dialog", size === "lg" && "dialog-lg")}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description !== undefined ? descId : undefined}
          tabIndex={-1}
          variants={dialogVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <header className="dialog-head">
            {icon !== undefined ? icon : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="dialog-title" id={titleId}>
                {title}
              </h2>
              {description !== undefined ? (
                <p className="dialog-desc" id={descId}>
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton label="Close" icon={<IconX size={18} />} onClick={onClose} disabled={busy} />
          </header>
          {children !== undefined ? <div className="dialog-body">{children}</div> : null}
          {footer !== undefined ? <footer className="dialog-foot">{footer}</footer> : null}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
