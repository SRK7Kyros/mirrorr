import { useEffect, useRef } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react"
import { SkeletonList } from "./Skeleton"

export interface TabListProps {
  readonly children: ReactNode
  /** Accessible name of the strip (usually the resource being viewed). */
  readonly label: string
  readonly className?: string
}

/**
 * TabList — role=tablist. Arrow keys move focus with a roving tabindex
 * (Home/End jump to the ends) per §8.4; the strip sits on the opaque `chrome`
 * bar (§11.8). The active-indicator slide is a `ui`-token `layoutId` job owned
 * by the shell.
 */
export function TabList({ children, label, className }: TabListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const classes = className === undefined ? "tabs" : `tabs ${className}`

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (selected !== null && selected !== undefined) selected.tabIndex = 0
  }, [children])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]
    if (!keys.includes(event.key)) return
    const list = listRef.current
    if (list === null) return
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
    if (tabs.length === 0) return
    const current = tabs.findIndex((tab) => tab === document.activeElement)
    const last = tabs.length - 1

    let next = current
    if (event.key === "ArrowRight") next = current >= last ? 0 : current + 1
    if (event.key === "ArrowLeft") next = current <= 0 ? last : current - 1
    if (event.key === "Home") next = 0
    if (event.key === "End") next = last
    if (next === current) return

    event.preventDefault()
    for (const [index, tab] of tabs.entries()) tab.tabIndex = index === next ? 0 : -1
    tabs[next]?.focus()
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={classes} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

export interface TabProps {
  readonly label: string
  readonly active: boolean
  readonly onSelect: () => void
  readonly badge?: ReactNode
  readonly id?: string
}

/** Tab — label-caps on the chrome strip; active plate is a surface pill with #141414 label. */
export function Tab({ label, active, onSelect, badge, id }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      className={active ? "tab tab--active" : "tab"}
      onClick={onSelect}
    >
      <span className="tab__label">{label}</span>
      {badge !== undefined ? <span className="tab__badge">{badge}</span> : null}
    </button>
  )
}

export interface TabPanelProps {
  readonly children: ReactNode
  readonly id?: string
  readonly labelledBy?: string
  readonly hidden?: boolean
  /** §6.4 panel loading: skeletons stay inside the panel, chrome stays put. */
  readonly loading?: boolean
  readonly error?: ReactNode
  readonly empty?: ReactNode
}

/** TabPanel — role=tabpanel; loading/error/empty resolve inside the panel only. */
export function TabPanel({ children, id, labelledBy, hidden = false, loading = false, error, empty }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      hidden={hidden}
      tabIndex={-1}
      className="tab-panel"
    >
      {loading ? <SkeletonList rows={6} /> : (error ?? empty ?? children)}
    </div>
  )
}
