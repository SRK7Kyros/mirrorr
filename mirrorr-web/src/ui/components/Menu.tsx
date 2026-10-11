import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { menuVariants } from "@/ui/lib/motion"
import { IconButton } from "./IconButton"
import { IconMoreVertical } from "./icons"

/** Relative wrapper that anchors a `MenuPopover` to its trigger. */
export const menuAnchorClass = "relative inline-flex flex-none"

const MENU_ITEM_BASE =
  "flex items-center gap-2 w-full py-2 px-3 rounded-sm text-base text-left transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)] disabled:text-ink-faint disabled:cursor-not-allowed"

/**
 * One tone per render, never both: `text-ink` and `text-danger` set the same
 * property, so emitting both would make Tailwind's source order decide the colour.
 */
const MENU_ITEM_TONE = {
  default: "text-ink [&:hover:not(:disabled)]:bg-surface-4",
  danger: "text-danger [&:hover:not(:disabled)]:bg-danger-dim",
} as const

/** Default row styling — reused when a menu row is a link rather than a button. */
export const menuItemClass = cn(MENU_ITEM_BASE, MENU_ITEM_TONE.default)

export interface MenuItemProps {
  readonly children: ReactNode
  readonly icon?: ReactNode
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly onClick?: () => void
}

/** Row inside a menu. */
export function MenuItem({ children, icon, danger = false, disabled = false, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(MENU_ITEM_BASE, MENU_ITEM_TONE[danger ? "danger" : "default"])}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

export function MenuSeparator() {
  return <div className="h-px my-1 bg-line" role="separator" />
}

const MENU_BASE =
  "absolute z-[var(--z-popover)] min-w-[190px] p-1 bg-surface-3 border border-line-strong rounded-md shadow-elev-md"

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
 * Animated popover — enters and exits from its trigger edge. Shared by the
 * overflow menu, the account menu and the mobile nav burger. Positioned
 * relative to `menuAnchorClass`; `placement`/`align` are mutually exclusive
 * branches so only one `top-*`/`left-*` utility is ever emitted.
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
          className={cn(
            MENU_BASE,
            placement === "up" ? "top-auto bottom-[calc(100%_+_var(--s-2))]" : "top-[calc(100%_+_var(--s-2))]",
            align === "right" ? "right-0 left-auto" : "left-0",
            className,
          )}
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

/** Outside-click + Escape dismissal and arrow-key navigation for a `menuAnchorClass` popover. */
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
 * Overflow menu — a popover anchored to an icon button. Closes on outside
 * click, Escape, or item selection (each `MenuItem` calls its own `onClick`;
 * the wrapper closes on any click inside).
 */
export function DropdownMenu({ children, label = "More actions", align = "right", className }: DropdownMenuProps) {
  const { open, setOpen, wrapRef } = useMenuDismiss()

  return (
    <div ref={wrapRef} className={cn(menuAnchorClass, className)}>
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
