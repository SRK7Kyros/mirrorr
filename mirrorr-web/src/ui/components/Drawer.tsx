import { useEffect, useRef, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { drawerVariants, overlayVariants } from "@/ui/lib/motion"
import { IconButton } from "./IconButton"
import { IconX } from "./icons"

/**
 * Slide-over panel, built on Radix `Dialog` (same behaviours as `Dialog`:
 * scroll-lock, background isolation, trapped focus, overlay stacking). `side`
 * selects the edge and the matching `drawerVariants` travel direction.
 * `raised` stacks it above an already-open dialog.
 *
 * `className` is still forwarded, so callers may pass layout utilities
 * (e.g. a wide variant) that layer over the default width.
 */
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

const HEAD_CLASS = "flex items-center justify-between gap-3 p-4 border-b border-line-subtle min-h-[var(--topbar-h)]"
const BODY_CLASS = "flex-1 overflow-y-auto p-4"
const FOOT_CLASS = "flex items-center justify-end gap-2 py-3 px-4 border-t border-line-subtle bg-surface-2"

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
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) restoreRef.current = document.activeElement as HTMLElement | null
  }, [open])

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      modal
    >
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className={cn(
                  "fixed inset-0 bg-[var(--overlay-scrim)] backdrop-blur-[2px]",
                  raised ? "z-[calc(var(--z-modal)_+_1)]" : "z-[var(--z-drawer)]",
                )}
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                aria-hidden="true"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                restoreRef.current?.focus()
              }}
            >
              <motion.aside
                className={cn(
                  "fixed inset-y-0 flex flex-col bg-surface-1 shadow-elev-lg",
                  side === "right" ? "right-0 w-[min(28rem,100vw)] border-l border-line" : "left-0 w-[min(28rem,100vw)] border-r border-line",
                  raised ? "z-[calc(var(--z-modal)_+_2)]" : "z-[calc(var(--z-drawer)_+_1)]",
                  className,
                )}
                variants={drawerVariants(side)}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <header className={HEAD_CLASS}>
                  <DialogPrimitive.Title asChild>
                    <h2 className="text-lg font-semibold leading-tight">{title}</h2>
                  </DialogPrimitive.Title>
                  <IconButton label="Close" icon={<IconX size={18} />} onClick={onClose} />
                </header>
                <div className={BODY_CLASS}>{children}</div>
                {footer !== undefined ? <footer className={FOOT_CLASS}>{footer}</footer> : null}
              </motion.aside>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
