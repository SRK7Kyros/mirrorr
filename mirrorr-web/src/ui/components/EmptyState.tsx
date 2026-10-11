import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { IconInfo } from "./icons"

const EMPTY_BASE = "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-ink-dim"

const EMPTY_ICON = "grid place-content-center w-11 h-11 rounded-md bg-surface-2 border border-line text-ink-dim"

const EMPTY_TITLE = "text-md font-semibold text-ink-muted"

const EMPTY_TEXT = "text-base max-w-[32ch]"

export interface EmptyStateProps {
  readonly icon?: ReactNode
  readonly title: ReactNode
  readonly text?: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}

/** Centred empty/zero-data state. */
export function EmptyState({ icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn(EMPTY_BASE, className)}>
      <span className={EMPTY_ICON} aria-hidden="true">
        {icon ?? <IconInfo size={22} />}
      </span>
      <p className={EMPTY_TITLE}>{title}</p>
      {text !== undefined ? <p className={EMPTY_TEXT}>{text}</p> : null}
      {action}
    </div>
  )
}