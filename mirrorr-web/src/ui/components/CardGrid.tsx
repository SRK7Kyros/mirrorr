import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { Skeleton } from "./Skeleton"

/**
 * The only grid in the app. Three columns ≥1280, two 768–1279, one below,
 * row-major source order, every card stretched to one height per surface.
 *
 * `auto-rows-fr` is what makes "uniform" true rather than aspirational: the
 * tallest card in a row sets the row height and its siblings fill it, so a
 * live run, a spent one and a failed plate all occupy the same rectangle and
 * the grid never reflows when a state changes.
 */
export function CardGrid({
  children,
  className,
  label,
  rowHeight,
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly label?: string
  /** The recipe's card height. Rows are never shorter, so a state change cannot reflow the grid. */
  readonly rowHeight?: number
}) {
  return (
    <div
      data-slot="card-grid"
      aria-label={label}
      style={rowHeight === undefined ? undefined : { gridAutoRows: `minmax(${rowHeight}px, auto)` }}
      className={cn(
        "grid auto-rows-fr grid-cols-1 items-stretch gap-3.5 md:grid-cols-2 xl:grid-cols-3",
        "[&>*]:min-w-0 [&>*]:max-w-[var(--card-max)] [&>*]:justify-self-stretch",
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Loading state: cards shaped like the recipe they stand in for, at the same
 * height — so the page does not jump when the real rows arrive. `media` is the
 * slot that decides the height, so the skeleton mirrors it.
 */
export function CardGridSkeleton({
  count = 6,
  media = true,
  className,
  label = "Loading",
}: {
  readonly count?: number
  readonly media?: boolean
  readonly className?: string
  readonly label?: string
}) {
  return (
    <div
      data-slot="card-grid-skeleton"
      className={cn(
        "grid auto-rows-fr grid-cols-1 items-stretch gap-3.5 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface-2"
        >
          <div className="flex items-center gap-2 px-4 pt-3">
            <Skeleton width={92} height={22} />
            <span className="flex-1" />
            <Skeleton width={22} height={22} />
          </div>
          {media ? (
            <div className="pt-3">
              <span className="block aspect-video w-full skeleton-shimmer" aria-hidden="true" />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 px-4 pt-3">
            <Skeleton width="62%" height={18} />
            <Skeleton width="40%" height={12} />
          </div>
          <div className="mt-auto flex flex-col gap-2 px-4 pt-3 pb-4">
            <Skeleton width="78%" height={14} />
            <Skeleton width="46%" height={11} />
          </div>
        </div>
      ))}
    </div>
  )
}
