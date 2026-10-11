import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

const PROGRESS_BASE = "h-1 rounded-full bg-surface-4 overflow-hidden"

const FILL_BASE = "h-full rounded-full transition-[width] duration-[var(--dur-med)] ease-[var(--ease-out)]"

const FILL_TONE = {
  accent: "bg-brand",
  secondary: "[background-color:var(--secondary)]",
} as const

const STAT_BASE = "flex flex-col gap-0.5"

const STAT_LABEL = "text-xs uppercase tracking-[0.05em] text-ink-dim"

const STAT_VALUE = "font-medium text-ink leading-[1.1] [font-family:var(--font-mono)] tabular-nums"

const STAT_VALUE_SIZE = {
  default: "text-xl",
  small: "text-md",
} as const

export interface ProgressProps {
  readonly value: number
  readonly max?: number
  readonly tone?: "accent" | "secondary"
  readonly label?: string
  readonly className?: string
}

/** Determinate bar. */
export function Progress({ value, max = 100, tone = "accent", label, className }: ProgressProps) {
  const pct = !Number.isFinite(value) || max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      className={cn(PROGRESS_BASE, className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn(FILL_BASE, FILL_TONE[tone])} data-tone={tone === "secondary" ? "secondary" : undefined} style={{ width: `${pct}%` }} />
    </div>
  )
}

export interface StatProps {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly small?: boolean
}

/** Label + mono value. */
export function Stat({ label, value, small = false }: StatProps) {
  return (
    <div className={STAT_BASE}>
      <span className={STAT_LABEL}>{label}</span>
      <span className={cn(STAT_VALUE, small ? STAT_VALUE_SIZE.small : STAT_VALUE_SIZE.default)}>{value}</span>
    </div>
  )
}