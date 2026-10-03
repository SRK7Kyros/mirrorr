import { motion, useReducedMotion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import type { ReactNode } from "react"
import { micro } from "./motion-tokens"
import { Spinner } from "./Spinner"

export interface FabProps extends HTMLMotionProps<"button"> {
  /** Required — FAB is icon-only (§6: aria-label + tooltip). */
  readonly "aria-label": string
  readonly icon: ReactNode
  readonly loading?: boolean
}

/**
 * FAB — 56px circle, the view's single primary action. Press uses the `micro`
 * token (scale 0.96) and is dropped under reduced motion. Placement is the
 * shell's concern; the primitive stays unpositioned.
 */
export function Fab({ icon, loading = false, className, disabled, type = "button", ...rest }: FabProps) {
  const reduced = useReducedMotion()
  const classes = className === undefined ? "fab" : `fab ${className}`

  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      whileTap={disabled === true || loading || reduced === true ? undefined : { scale: 0.96 }}
      transition={micro}
      {...rest}
    >
      {loading ? <Spinner size="lg" /> : icon}
    </motion.button>
  )
}
