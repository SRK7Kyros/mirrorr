import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

const BADGE_BASE =
  "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-2xs font-bold tabular-nums leading-none [font-family:var(--font-mono)]"

const BADGE_VARIANT = {
  accent: "bg-brand text-brand-ink",
  neutral: "bg-surface-4 text-ink-muted",
  danger: "bg-danger text-white",
} as const

const TAG_BASE =
  "inline-flex items-center gap-1 h-[22px] px-2 rounded-xs border text-xs whitespace-nowrap [font-family:var(--font-mono)]"

const TAG_VARIANT = {
  default: "bg-surface-2 border-line-subtle text-ink-muted",
  accent: "[background-color:var(--accent-dim)] [border-color:var(--accent-line)] text-brand",
} as const

export interface BadgeProps {
  readonly children: ReactNode
  readonly variant?: "accent" | "neutral" | "danger"
  readonly className?: string
  readonly title?: string
}

/** Count badge. */
export function Badge({ children, variant = "accent", className, title }: BadgeProps) {
  return (
    <span className={cn(BADGE_BASE, BADGE_VARIANT[variant], className)} title={title}>
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
    <span className={cn(TAG_BASE, accent ? TAG_VARIANT.accent : TAG_VARIANT.default, className)} title={title}>
      {children}
    </span>
  )
}