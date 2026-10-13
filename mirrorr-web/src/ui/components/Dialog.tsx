import { useEffect, useRef, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { dialogVariants, overlayVariants } from "@/ui/lib/motion"
import { IconButton } from "./IconButton"
import { IconX } from "./icons"

/**
 * Modal dialog.
 *
 * Behaviour is Radix's `Dialog`: background scroll-lock, background
 * `aria-hidden` isolation, a trapped focus scope and nested-overlay stacking
 * (the last open layer alone answers Escape). Motion is still `motion/react`
 * (`dialogVariants` / `overlayVariants`) via `forceMount`, so the entry/exit
 * springs are unchanged.
 *
 * Focus restore is deliberate: Radix returns focus to its own `Trigger`, but
 * every mirrorr dialog is driven by an external button, so we capture the
 * previously focused element on open and restore it in `onCloseAutoFocus`.
 */
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

const OVERLAY_CLASS = "fixed inset-0 bg-[var(--overlay-scrim)] backdrop-blur-[2px] z-[var(--z-modal)]"

const HEAD_CLASS = "flex items-start gap-3 pt-5 px-5 pb-3"
const DESC_CLASS = "text-ink-muted text-base mt-1"
const BODY_CLASS = "px-5 pb-4 overflow-y-auto overflow-x-hidden flex flex-col gap-4"
const FOOT_CLASS = "flex items-center justify-end gap-2 py-4 px-5 border-t border-line-subtle bg-surface-1 rounded-b-lg"

const CONTENT_BASE =
  "fixed top-1/2 left-1/2 flex flex-col max-h-[calc(100dvh_-_48px_-_env(safe-area-inset-top,0px)_-_env(safe-area-inset-bottom,0px))] bg-surface-2 border border-line-strong rounded-lg shadow-elev-lg z-[calc(var(--z-modal)_+_1)]"

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
                className={OVERLAY_CLASS}
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
              onEscapeKeyDown={(event) => {
                if (busy) event.preventDefault()
              }}
              onInteractOutside={(event) => {
                if (busy) event.preventDefault()
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                restoreRef.current?.focus()
              }}
            >
              <motion.div
                className={cn(CONTENT_BASE, size === "lg" ? "w-[min(46rem,calc(100vw_-_32px))]" : "w-[min(30rem,calc(100vw_-_32px))]")}
                variants={dialogVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <header className={HEAD_CLASS}>
                  {icon !== undefined ? icon : null}
                  <div className="flex-1 min-w-0">
                    <DialogPrimitive.Title asChild>
                      <h2 className="text-lg font-semibold leading-tight">{title}</h2>
                    </DialogPrimitive.Title>
                    {description !== undefined ? (
                      <DialogPrimitive.Description asChild>
                        <p className={DESC_CLASS}>{description}</p>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  <IconButton label="Close" icon={<IconX size={18} />} onClick={onClose} disabled={busy} />
                </header>
                {children !== undefined ? <div className={BODY_CLASS}>{children}</div> : null}
                {footer !== undefined ? <footer className={FOOT_CLASS}>{footer}</footer> : null}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
