import { useId, type ReactNode } from "react"
import { motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { springs } from "@/ui/lib/motion"

export interface TabItem<T extends string = string> {
  readonly id: T
  readonly label: ReactNode
  readonly count?: number
  readonly disabled?: boolean
}

export interface TabsProps<T extends string = string> {
  readonly items: readonly TabItem<T>[]
  readonly active: T
  readonly onChange: (id: T) => void
  readonly className?: string
  readonly ariaLabel?: string
}

/** Underline tabs — `.tabs` > `.tab[data-active]`. */
export function Tabs<T extends string>({ items, active, onChange, className, ariaLabel }: TabsProps<T>) {
  const indicatorId = useId()
  return (
    <div className={cn("tabs", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="tab"
          data-active={item.id === active}
          aria-selected={item.id === active}
          disabled={item.disabled === true}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined ? <span className="nav-count">{item.count}</span> : null}
          {item.id === active ? (
            <motion.span
              layoutId={`tab-indicator-${indicatorId}`}
              className="tab-indicator"
              transition={springs.snappy}
            />
          ) : null}
        </button>
      ))}
    </div>
  )
}

export interface SegmentedProps<T extends string = string> {
  readonly items: readonly TabItem<T>[]
  readonly active: T
  readonly onChange: (id: T) => void
  readonly className?: string
  readonly ariaLabel?: string
}

/** Segmented control — `.segmented` > `.segmented-item[data-active]`. */
export function Segmented<T extends string>({ items, active, onChange, className, ariaLabel }: SegmentedProps<T>) {
  const indicatorId = useId()
  return (
    <div className={cn("segmented", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="segmented-item"
          data-active={item.id === active}
          aria-selected={item.id === active}
          disabled={item.disabled === true}
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
