import type { CSSProperties } from "react"
import { motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { motionTokens } from "@/ui/lib/motion"

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
  return <span className={cn("skeleton-shimmer", className)} style={style} aria-hidden="true" />
}

export function SkeletonRows({ rows = 6, cols = 4 }: { readonly rows?: number; readonly cols?: number }) {
  return (
    <motion.div
      className="flex flex-col gap-2"
      aria-busy="true"
      aria-label="Loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionTokens.duration.fast }}
    >
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3" style={{ gap: "var(--s-4)" }}>
          {Array.from({ length: cols }, (_, colIndex) => (
            <Skeleton key={colIndex} height={12} width={colIndex === 0 ? "22%" : `${16 + colIndex * 4}%`} />
          ))}
        </div>
      ))}
    </motion.div>
  )
}