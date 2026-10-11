import { useId, useRef, type KeyboardEvent, type ReactNode } from "react"
import { motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { springs } from "@/ui/lib/motion"

export interface TabItem<T extends string = string> {
  readonly id: T
  readonly label: ReactNode
  readonly count?: number
  readonly disabled?: boolean
}

function useRovingTabs<T extends string>(items: readonly TabItem<T>[], onChange: (id: T) => void) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const register = (id: T) => (element: HTMLButtonElement | null) => {
    if (element === null) refs.current.delete(id)
    else refs.current.set(id, element)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentId: T): void => {
    const enabled = items.filter((item) => item.disabled !== true)
    if (enabled.length === 0) return
    const index = enabled.findIndex((item) => item.id === currentId)
    let nextIndex: number | null = null
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % enabled.length
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + enabled.length) % enabled.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = enabled.length - 1
    }
    if (nextIndex === null) return
    event.preventDefault()
    const next = enabled[nextIndex]
    if (next === undefined) return
    onChange(next.id)
    refs.current.get(next.id)?.focus()
  }
  return { register, onKeyDown }
}

export interface SegmentedProps<T extends string = string> {
  readonly items: readonly TabItem<T>[]
  readonly active: T
  readonly onChange: (id: T) => void
  readonly className?: string
  readonly ariaLabel?: string
  readonly panelId?: string
}

/** Segmented control — `.segmented` > `.segmented-item[data-active]`. */
export function Segmented<T extends string>({
  items,
  active,
  onChange,
  className,
  ariaLabel,
  panelId,
}: SegmentedProps<T>) {
  const indicatorId = useId()
  const { register, onKeyDown } = useRovingTabs(items, onChange)
  return (
    <div className={cn("segmented", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          id={panelId === undefined ? undefined : tabId(panelId, item.id)}
          role="tab"
          aria-controls={panelId}
          className="segmented-item"
          data-active={item.id === active}
          aria-selected={item.id === active}
          tabIndex={item.id === active ? 0 : -1}
          disabled={item.disabled === true}
          ref={register(item.id)}
          onKeyDown={(event) => onKeyDown(event, item.id)}
          onClick={() => onChange(item.id)}
        >
          {item.id === active ? (
            <motion.span
              layoutId={`segmented-thumb-${indicatorId}`}
              className="segmented-thumb"
              transition={springs.snappy}
            />
          ) : null}
          <span className="segmented-label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Tab button id within a `panelId` group — pair of `TabPanel`. */
export function tabId(panelId: string, item: string): string {
  return `${panelId}-tab-${item}`
}

/** `role="tabpanel"` region controlled by the `Segmented` group of the same `panelId`. */
export function TabPanel({
  panelId,
  active,
  className,
  children,
}: {
  readonly panelId: string
  readonly active?: string
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={active === undefined ? undefined : tabId(panelId, active)}
      className={className}
    >
      {children}
    </div>
  )
}
