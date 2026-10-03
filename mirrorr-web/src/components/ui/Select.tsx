import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { IconCheck, IconChevronDown } from "./icons"
import { ui } from "./motion-tokens"

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps {
  readonly label: string
  readonly options: ReadonlyArray<SelectOption>
  readonly value: string | null
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly helper?: string
  readonly error?: string
  readonly loading?: boolean
  readonly disabled?: boolean
  readonly required?: boolean
  readonly id?: string
}

/**
 * Select / combobox — §6.2: trigger mirrors Input (acrylic 0.72/16 or opaque
 * twin, hover/focus/error/disabled). The listbox is acrylic 0.72/24 (modal
 * tier), opens on the `ui` token, selected row carries a primary 2px left bar,
 * the active option takes the two-layer focus ring, and an empty option set
 * renders "No options." (never a blank popover). Keyboard: Enter/Space/↓ opens,
 * arrows move, Enter commits, Esc closes and returns focus to the trigger.
 */
export function Select({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  helper,
  error,
  loading = false,
  disabled = false,
  required = false,
  id,
}: SelectProps) {
  const reduced = useReducedMotion()
  const generatedId = useId()
  const selectId = id ?? generatedId
  const helperId = `${selectId}-helper`
  const listboxId = `${selectId}-listbox`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const hasError = error !== undefined && error.length > 0
  const helperText = hasError ? error : helper
  const selected = options.find((option) => option.value === value) ?? null

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) !== true) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const closeAndFocus = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commit = (index: number) => {
    const option = options[index]
    if (option === undefined) return
    onChange(option.value)
    closeAndFocus()
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
      setOpen(true)
    }
  }

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeAndFocus()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      commit(activeIndex)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index) => Math.min(options.length - 1, index + 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
    }
  }

  const triggerClasses = [
    "select__trigger",
    "acrylic",
    "acrylic--input",
    hasError ? "select__trigger--error" : null,
  ]
    .filter((part) => part !== null)
    .join(" ")

  return (
    <div className="field">
      <label className="field__label" id={`${selectId}-label`} htmlFor={selectId}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="select">
        <button
          ref={triggerRef}
          type="button"
          id={selectId}
          className={triggerClasses}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
          aria-busy={loading || undefined}
          aria-describedby={helperText !== undefined && helperText.length > 0 ? helperId : undefined}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setOpen((isOpen) => !isOpen)
          }}
          onKeyDown={onTriggerKeyDown}
        >
          <span className={selected === null ? "select__value--placeholder" : undefined}>
            {selected === null ? placeholder : selected.label}
          </span>
          <span className="select__chevron">
            <IconChevronDown size={16} />
          </span>
        </button>
        <AnimatePresence>
          {open ? (
            <motion.ul
              id={listboxId}
              role="listbox"
              aria-labelledby={`${selectId}-label`}
              className="select__menu acrylic acrylic--modal acrylic--r-sm"
              initial={{ opacity: 0, y: reduced === true ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={ui}
              onKeyDown={onListKeyDown}
            >
              {options.length === 0 ? (
                <li className="select__empty" role="presentation">
                  No options.
                </li>
              ) : (
                options.map((option, index) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={index === activeIndex}
                    className="select__option"
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                  >
                    <span className="ellipsis">{option.label}</span>
                    {option.value === value ? (
                      <span className="select__check">
                        <IconCheck size={14} />
                      </span>
                    ) : null}
                  </li>
                ))
              )}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
      {helperText !== undefined && helperText.length > 0 ? (
        <span id={helperId} className={hasError ? "field__helper field__helper--error" : "field__helper"}>
          {helperText}
        </span>
      ) : null}
    </div>
  )
}
