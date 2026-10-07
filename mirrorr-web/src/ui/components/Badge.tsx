import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface BadgeProps {
  readonly children: ReactNode
  readonly variant?: "accent" | "neutral" | "danger"
  readonly className?: string
  readonly title?: string
}

/** Count badge — `.badge` variants from components.css. */
export function Badge({ children, variant = "accent", className, title }: BadgeProps) {
  return (
    <span
      className={cn("badge", variant === "neutral" && "badge-neutral", variant === "danger" && "badge-danger", className)}
      title={title}
    >
      {children}
    </span>
  )
}

export interface TagProps {
  readonly children: ReactNode
  readonly accent?: boolean
  readonly className?: string
  readonly title?: string
}

/** Mono metadata tag (ids, hashes, engine names). */
export function Tag({ children, accent = false, className, title }: TagProps) {
  return (
    <span className={cn("tag", accent && "tag-accent", className)} title={title}>
      {children}
    </span>
  )
}
