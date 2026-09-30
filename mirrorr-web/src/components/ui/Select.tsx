import { AnimatePresence, motion } from "motion/react"
import { useEffect, useId, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { IconCheck, IconChevronDown } from "./icons"

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
  readonly disabled?: boolean
  readonly required?: boolean
  readonly id?: string
}

/** motion token `ui` — spring 300/24 (§8 component state change). */
const uiSpring = { type: "spring", stiffness: 300, damping: 24 } as const

/**
 * Select — §4 matrix: trigger mirrors Input (hover/focus/error/disabled),
 * open menu = bg-raised + border-standard + overlay shadow, option hover
 * fill-hover, selected fill-active + 14px check `#7DB1E5`.
 * Keyboard: Enter/Space opens, arrows move, Enter selects, Esc closes and
 * returns focus to trigger; roles listbox/option + aria-haspopup (§4/§7).
 */
export function Select({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  helper,
  error,
  disabled = false,
  required = false,
  id,
}: SelectProps) {
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
      if (triggerRef.current?.contains(target) !== true) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
    }
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
      const startIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value),
      )
      setActiveIndex(startIndex)
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
          className={hasError ? "select__trigger select__trigger--error" : "select__trigger"}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
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
              className="select__menu"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={uiSpring}
              style={{ transformOrigin: "top" }}
              onKeyDown={onListKeyDown}
            >
              {options.map((option, index) => (
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
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
      {helperText !== undefined && helperText.length > 0 ? (
        <span
          id={helperId}
          className={hasError ? "field__helper field__helper--error" : "field__helper"}
        >
          {helperText}
        </span>
      ) : null}
    </div>
  )
}
