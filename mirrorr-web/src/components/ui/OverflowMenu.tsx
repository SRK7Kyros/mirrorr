import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { IconMoreH } from "./icons"
import { ui } from "./motion-tokens"

export interface OverflowMenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly destructive?: boolean
  readonly disabled?: boolean
  /** §6.4: a disabled item explains itself inline, never silently. */
  readonly disabledReason?: string
}

export interface OverflowMenuProps {
  readonly items: ReadonlyArray<OverflowMenuItem>
  /** Accessible name of the trigger (copy uses verbs, e.g. "More actions"). */
  readonly triggerLabel: string
  readonly align?: "start" | "end"
}

/** §6.4: destructive items always sort last, keeping the destructive edge. */
function orderItems(items: ReadonlyArray<OverflowMenuItem>): OverflowMenuItem[] {
  const safe = items.filter((item) => item.destructive !== true)
  const destructive = items.filter((item) => item.destructive === true)
  return [...safe, ...destructive]
}

/**
 * OverflowMenu — §6.4: 40×40 trigger (44 on coarse pointers), acrylic 0.72/24
 * panel (modal tier), radius 4, 8px pad, 44px items. Opens on the `ui` token.
 * Destructive items sort last; disabled items carry inline reason text; when
 * the action set is empty the menu is not rendered at all (absent, not
 * disabled). Keyboard: Enter/Space/↓ opens + focuses first, ↑/↓ cycle,
 * Home/End jump, Esc closes and restores trigger focus, outside click closes.
 */
export function OverflowMenu({ items, triggerLabel, align = "end" }: OverflowMenuProps) {
  const reduced = useReducedMotion()
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const ordered = orderItems(items)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  if (ordered.length === 0) return null

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
            className={
              align === "start"
                ? "overflow__menu overflow__menu--start acrylic acrylic--modal acrylic--r-sm"
                : "overflow__menu acrylic acrylic--modal acrylic--r-sm"
            }
            initial={{ opacity: 0, y: reduced === true ? 0 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={ui}
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
                <span className="overflow__item-label">{item.label}</span>
                {item.disabled === true && item.disabledReason !== undefined ? (
                  <span className="overflow__item-reason">{item.disabledReason}</span>
                ) : null}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
