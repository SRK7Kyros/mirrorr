import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface ProgressProps {
  readonly value: number
  readonly max?: number
  readonly tone?: "accent" | "secondary"
  readonly label?: string
  readonly className?: string
}

/** Determinate bar — `.progress` > `.progress-fill`. */
export function Progress({ value, max = 100, tone = "accent", label, className }: ProgressProps) {
  const pct = !Number.isFinite(value) || max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      className={cn("progress", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="progress-fill" data-tone={tone === "secondary" ? "secondary" : undefined} style={{ width: `${pct}%` }} />
    </div>
  )
}

export interface StatProps {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly small?: boolean
}

/** Label + mono value — `.stat`. */
export function Stat({ label, value, small = false }: StatProps) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={cn("stat-value", small && "stat-value-sm")}>{value}</span>
    </div>
  )
}
