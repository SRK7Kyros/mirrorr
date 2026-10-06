import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { IconInfo } from "./icons"

export interface EmptyStateProps {
  readonly icon?: ReactNode
  readonly title: ReactNode
  readonly text?: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}

/** Centred empty/zero-data state — `.empty`. */
export function EmptyState({ icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn("empty", className)}>
      <span className="empty-icon" aria-hidden="true">
        {icon ?? <IconInfo size={22} />}
      </span>
      <p className="empty-title">{title}</p>
      {text !== undefined ? <p className="empty-text">{text}</p> : null}
      {action}
    </div>
  )
}
