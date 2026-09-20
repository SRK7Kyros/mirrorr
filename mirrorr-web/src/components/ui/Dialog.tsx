import { X } from "lucide-react"
import { useEffect, useId, useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/Button"
import { pushBackInterceptor } from "@/lib/back-navigation"

/**
 * Dialog — spec L111: max-width 560px (wizards 720px), `bg-overlay`, radius 6,
 * 16px/600 header with border-bottom, right-aligned footer. Focus enters on
 * open, is trapped while open, Esc cancels, and focus returns to the opener on
 * close (spec L405, L473). While open it is also the topmost back consumer
 * (spec L498): an open sheet/drawer closes before history moves. ConfirmDialog
 * reuses this shell at 400px.
 */

export type DialogSize = "dialog" | "wizard" | "confirm"

const WIDTHS: Record<DialogSize, string> = {
  dialog: "max-w-[560px]",
  wizard: "max-w-[720px]",
  confirm: "max-w-[400px]",
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export interface DialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly size?: DialogSize
}

export function Dialog({ open, onClose, title, children, footer, size = "dialog" }: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  // Focus enters the dialog on open and returns to the opener on close.
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = panel ? focusableWithin(panel) : []
    const first = focusables[0]
    if (first !== undefined) first.focus()
    else panel?.focus()

    return () => {
      openerRef.current?.focus()
    }
  }, [open])

  // The handler is read through a ref so an `onClose` identity change does not
  // re-register an open dialog above a newer one (which would steal its back).
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // While open, the dialog consumes the platform back before history (L498).
  useEffect(() => {
    if (!open) return
    return pushBackInterceptor(() => onCloseRef.current())
  }, [open])

  // Esc cancels; Tab cycles inside the panel.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return

      const panel = panelRef.current
      if (panel === null) return
      const focusables = focusableWithin(panel)
      if (focusables.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (first === undefined || last === undefined) return

      const active = document.activeElement
      const activeInside = active instanceof HTMLElement && panel.contains(active)
      if (event.shiftKey && (active === first || !activeInside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !activeInside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="dialog-overlay"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-bg-base/70"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          "relative w-full rounded-surface border border-border bg-bg-overlay shadow-overlay",
          WIDTHS[size],
        ].join(" ")}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-title font-semibold text-text-primary">
            {title}
          </h2>
          <Button
            variant="ghost"
            icon={X}
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onClose}
          />
        </header>
        <div className="px-4 py-4 text-body text-text-secondary">{children}</div>
        {footer !== undefined ? (
          <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  )
}
