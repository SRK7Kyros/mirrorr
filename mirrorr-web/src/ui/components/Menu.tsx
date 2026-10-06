import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { IconButton } from "./IconButton"
import { IconMoreVertical } from "./icons"

export interface MenuItemProps {
  readonly children: ReactNode
  readonly icon?: ReactNode
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onClick?: () => void
}

/** Row inside a menu — `.menu-item` (+ `.menu-item-danger`). */
export function MenuItem({ children, icon, danger = false, disabled = false, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn("menu-item", danger && "menu-item-danger")}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />
}

export function MenuLabel({ children }: { readonly children: ReactNode }) {
  return <div className="menu-label">{children}</div>
}

export interface DropdownMenuProps {
  readonly children: ReactNode
  readonly label?: string
  readonly trigger?: ReactNode
  readonly align?: "left" | "right"
  readonly className?: string
}

/**
 * Overflow menu — a `.menu` popover anchored to an icon button. Closes on
 * outside click, Escape, or item selection (each `MenuItem` calls its own
 * `onClick`; the wrapper closes on any click inside).
 */
export function DropdownMenu({ children, label = "More actions", trigger, align = "right", className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }} className={className}>
      {trigger !== undefined ? (
        <span onClick={() => setOpen((value) => !value)}>{trigger}</span>
      ) : (
        <IconButton
          label={label}
          icon={<IconMoreVertical size={18} />}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        />
      )}
      {open ? (
        <div
          className="menu"
          role="menu"
          style={{ top: "calc(100% + 4px)", [align]: 0 }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
