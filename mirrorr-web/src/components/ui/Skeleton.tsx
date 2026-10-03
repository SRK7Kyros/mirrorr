export interface SkeletonProps {
  /** row = 36px table/list line; card = 96px compact card block (§6.5). */
  readonly geometry?: "row" | "card"
  readonly className?: string
}

/**
 * Skeleton — §6.5: opaque blocks in a `secondary`@8-14% wash, radius 4,
 * shaped like the final layout. **No shimmer, no spinner-by-default** (§6.5);
 * the skeleton→content swap is a 0.2s `tween-enter` opacity crossfade owned by
 * the caller. Always aria-hidden — the caller owns the aria-busy container.
 */
export function Skeleton({ geometry = "row", className }: SkeletonProps) {
  const classes = ["skeleton", geometry === "row" ? "skeleton--row" : "skeleton--card", className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return <span aria-hidden="true" className={classes} />
}

export interface SkeletonListProps {
  readonly rows?: number
  readonly className?: string
}

/** Stacked row geometry for the §6.4 loading-state table/list placeholder. */
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
