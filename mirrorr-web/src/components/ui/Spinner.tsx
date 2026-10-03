export interface SpinnerProps {
  readonly size?: "sm" | "md" | "lg"
  /** Accessible status text; omit for decorative spinners (icon slots). */
  readonly label?: string
  readonly className?: string
}

const sizeClass = {
  sm: "spinner spinner--sm",
  md: "spinner",
  lg: "spinner spinner--lg",
} as const

/**
 * Spinner — §9.15: one rotation per 0.8s, derived from the `tween-enter` token
 * (a 0.2s quarter-turn × 4 — no fifth number). Under
 * `prefers-reduced-motion: reduce` base.css freezes it to a static ring so the
 * status word does the work.
 */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const classes = className === undefined ? sizeClass[size] : `${sizeClass[size]} ${className}`

  if (label !== undefined) {
    return <span role="status" aria-label={label} className={classes} />
  }

  return <span aria-hidden="true" className={classes} />
}
