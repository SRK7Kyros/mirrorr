import { AnimatePresence, motion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { IconMoreH } from "./icons"

export interface OverflowMenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly destructive?: boolean
  readonly disabled?: boolean
}

export interface OverflowMenuProps {
  readonly items: ReadonlyArray<OverflowMenuItem>
  /** Accessible name of the trigger (spec: copy uses verbs, e.g. "More actions"). */
  readonly triggerLabel: string
  readonly align?: "start" | "end"
}

/** motion `ui` spring — component state change (§8). */
const uiSpring = { type: "spring", stiffness: 300, damping: 24 } as const

/** §4: destructive items always sort last, keeping the destructive edge. */
function orderItems(items: ReadonlyArray<OverflowMenuItem>): OverflowMenuItem[] {
  const safe = items.filter((item) => item.destructive !== true)
  const destructive = items.filter((item) => item.destructive === true)
  return [...safe, ...destructive]
}

/**
 * OverflowMenu — §4: 24px ghost trigger (32/44 compact hit area),
 * 200px menu, r8, border-standard, shadow-menu (overlay layer), items 32px
 * (44 compact), hover fill-hover, destructive `#FF6B77` last with its own
 * hover tint. Keyboard: Enter/Space opens + focuses first, ArrowUp/Down
 * cycle, Esc closes and restores trigger focus, outside pointer dismiss.
 * Enter on an item fires it and closes (spec: no arrow-then-enter ceremony).
 */
export function OverflowMenu({ items, triggerLabel, align = "end" }: OverflowMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const ordered = orderItems(items)
  const menuClass = align === "start" ? "overflow__menu overflow__menu--start" : "overflow__menu"

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const openMenu = () => {
    setActiveIndex(0)
    setOpen(true)
  }

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openMenu()
    }
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % ordered.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + ordered.length) % ordered.length)
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(ordered.length - 1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const item = ordered[activeIndex]
      if (item !== undefined && item.disabled !== true) {
        item.onSelect()
        closeMenu(true)
      }
    }
  }

  return (
    <div className="overflow" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="overflow__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <IconMoreH size={16} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={triggerLabel}
            className={menuClass}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={uiSpring}
            style={{ transformOrigin: align === "start" ? "top left" : "top right" }}
            onKeyDown={onMenuKeyDown}
          >
            {ordered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-disabled={item.disabled || undefined}
                className={
                  item.destructive === true
                    ? "overflow__item overflow__item--destructive"
                    : "overflow__item"
                }
                data-active={index === activeIndex}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => {
                  if (item.disabled === true) return
                  item.onSelect()
                  closeMenu(true)
                }}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
