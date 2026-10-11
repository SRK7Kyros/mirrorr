import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { menuVariants } from "@/ui/lib/motion"
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

export interface MenuPopoverProps {
  readonly open: boolean
  readonly children: ReactNode
  /** `down` (default) drops below the trigger; `up` rises above it. */
  readonly placement?: "down" | "up"
  readonly align?: "left" | "right"
  readonly className?: string
  readonly onClick?: () => void
}

/**
 * Animated `.menu` popover — enters and exits from its trigger edge. Shared by
 * the overflow menu, the account menu and the mobile nav burger.
 */
export function MenuPopover({
  open,
  children,
  placement = "down",
  align = "right",
  className,
  onClick,
}: MenuPopoverProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="menu"
          className={cn("menu", align === "right" && "menu-end", placement === "up" && "menu-up", className)}
          role="menu"
          variants={menuVariants(placement)}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClick}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export interface DropdownMenuProps {
  readonly children: ReactNode
  readonly label?: string
  readonly align?: "left" | "right"
  readonly className?: string
}

const MENU_ITEM = '[role="menuitem"]:not([disabled])'
const MENU_TRIGGER = 'button[aria-haspopup="menu"]'

/** Outside-click + Escape dismissal and arrow-key navigation for a `.menu-anchor` popover. */
export function useMenuDismiss() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const items = () => Array.from(wrapRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? [])
    const trigger = () => wrapRef.current?.querySelector<HTMLElement>(MENU_TRIGGER) ?? null

    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        trigger()?.focus()
        return
      }
      const list = items()
      if (list.length === 0) return
      const index = list.indexOf(document.activeElement as HTMLElement)
      let next: number
      if (event.key === "ArrowDown") next = (index + 1) % list.length
      else if (event.key === "ArrowUp") next = index <= 0 ? list.length - 1 : index - 1
      else if (event.key === "Home") next = 0
      else if (event.key === "End") next = list.length - 1
      else return
      event.preventDefault()
      list[next]?.focus()
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    items()[0]?.focus()
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return { open, setOpen, wrapRef }
}

/**
 * Overflow menu — a `.menu` popover anchored to an icon button. Closes on
 * outside click, Escape, or item selection (each `MenuItem` calls its own
 * `onClick`; the wrapper closes on any click inside).
 */
export function DropdownMenu({ children, label = "More actions", align = "right", className }: DropdownMenuProps) {
  const { open, setOpen, wrapRef } = useMenuDismiss()

  return (
    <div ref={wrapRef} className={cn("menu-anchor", className)}>
      <IconButton
        label={label}
        icon={<IconMoreVertical size={18} />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      <MenuPopover open={open} align={align} onClick={() => setOpen(false)}>
        {children}
      </MenuPopover>
    </div>
  )
}
