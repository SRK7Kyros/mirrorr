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
 * Indeterminate work-in-progress heartbeat (§8): CSS rotate 0.9s linear,
 * frozen under prefers-reduced-motion (base.css). Kept out of React renders.
 */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const classes = className === undefined ? sizeClass[size] : `${sizeClass[size]} ${className}`

  if (label !== undefined) {
    return (
      <span role="status" aria-label={label} className={classes} />
    )
  }

  return <span aria-hidden="true" className={classes} />
}
