import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/ui/lib/cn"
import { IconButton } from "./IconButton"
import { IconX } from "./icons"

export interface DrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly side?: "right" | "left"
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/** Slide-over panel — `.drawer` (+ `.drawer-left`). Portalled, Escape closes. */
export function Drawer({ open, onClose, title, side = "right", children, footer }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)

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

  if (!open) return null

  return createPortal(
    <>
      <div className="scrim drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={cn("drawer", side === "left" && "drawer-left")}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <h2 className="drawer-title">{title}</h2>
          <IconButton label="Close" icon={<IconX size={18} />} onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer !== undefined ? <footer className="panel-foot">{footer}</footer> : null}
      </aside>
    </>,
    document.body,
  )
}
