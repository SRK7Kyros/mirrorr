import type { CSSProperties } from "react"
import { cn } from "@/ui/lib/cn"

/** Shimmering placeholder block — `.skeleton` from components.css. */
export function Skeleton({
  width,
  height = 14,
  className,
}: {
  readonly width?: number | string
  readonly height?: number | string
  readonly className?: string
}) {
  const style: CSSProperties = { width, height }
  return <span className={cn("skeleton", className)} style={style} aria-hidden="true" />
}

/** A stack of skeleton rows sized for a table body. */
export function SkeletonRows({ rows = 6, cols = 4 }: { readonly rows?: number; readonly cols?: number }) {
  return (
    <div className="stack-sm" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="row" style={{ gap: "var(--s-4)" }}>
          {Array.from({ length: cols }, (_, colIndex) => (
            <Skeleton key={colIndex} height={12} width={colIndex === 0 ? "22%" : `${16 + colIndex * 4}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}
