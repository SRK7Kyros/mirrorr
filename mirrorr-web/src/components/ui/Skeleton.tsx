export interface SkeletonProps {
  /** row = 36px table/list line; card = 96px compact card block (§1). */
  readonly geometry?: "row" | "card"
  readonly className?: string
}

/**
 * Skeleton — placeholder geometry in bg-raised with a 1.4s shimmer sweep
 * (§1 shimmer + §8 rail: transform/opacity only). Static (no sweep) under
 * prefers-reduced-motion via base.css. Always aria-hidden with a
 * separate aria-busy container owned by the caller.
 */
export function Skeleton({ geometry = "row", className }: SkeletonProps) {
  const classes = [
    "skeleton",
    geometry === "row" ? "skeleton--row" : "skeleton--card",
    className,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ")

  return <span aria-hidden="true" className={classes} />
}

export interface SkeletonListProps {
  readonly rows?: number
  readonly className?: string
}

/** Stacked row geometry for the §4 loading-state table/list placeholder. */
export function SkeletonList({ rows = 5, className }: SkeletonListProps) {
  const classes = className === undefined ? "skeleton-list" : `skeleton-list ${className}`
  const safeRows = Math.max(0, Math.floor(rows))

  return (
    <div aria-hidden="true" className={classes}>
      {Array.from({ length: safeRows }, (_, index) => (
        <Skeleton key={index} geometry="row" />
      ))}
    </div>
  )
}
