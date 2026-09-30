import { motion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import type { ReactNode } from "react"
import { Spinner } from "./Spinner"

export interface FabProps extends HTMLMotionProps<"button"> {
  /** Required — FAB is icon-only (§4: aria-label + tooltip). */
  readonly "aria-label": string
  readonly icon: ReactNode
  readonly loading?: boolean
}

/** motion token `micro` — spring 400/30 (§8 press feedback, FAB scale .95). */
const microSpring = { type: "spring", stiffness: 400, damping: 30 } as const

/**
 * FAB — 56px circle, one primary action (§3.3/§4). Hidden by CSS outside the
 * compact shell (display:none ≥640). Loading swaps the 24px icon for a 20px
 * spinner; hidden by callers on read-only views (V9).
 */
export function Fab({
  icon,
  loading = false,
  className,
  disabled,
  type = "button",
  ...rest
}: FabProps) {
  const classes = className === undefined ? "fab" : `fab ${className}`

  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      whileTap={disabled === true || loading ? undefined : { scale: 0.95 }}
      transition={microSpring}
      {...rest}
    >
      {loading ? <Spinner size="lg" /> : icon}
    </motion.button>
  )
}
