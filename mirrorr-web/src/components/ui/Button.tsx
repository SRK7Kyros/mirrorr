import { motion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import type { ReactNode } from "react"
import { Spinner } from "./Spinner"

export type ButtonVariant = "primary" | "ghost" | "danger" | "danger-text"

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  readonly variant?: ButtonVariant
  /** Shows a 12px spinner in place of `icon`; label stays visible (§4). */
  readonly loading?: boolean
  /** Leading glyph replaced by the spinner while loading. */
  readonly icon?: ReactNode
  readonly children?: ReactNode
}

/** motion token `micro` — spring 400/30 (§1 motion_tokens). */
const microSpring = { type: "spring", stiffness: 400, damping: 30 } as const

/**
 * Button — §4 matrix: primary / ghost / danger / danger-text across
 * default · hover · pressed (whileTap .97) · focus ring · disabled · loading.
 * Copy uses verbs; never icon-only except FAB/back/copy/overflow.
 */
export function Button({
  variant = "primary",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn--${variant}`,
    loading ? "btn--loading" : null,
    className,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ")

  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      whileTap={disabled === true || loading ? undefined : { scale: 0.97 }}
      transition={microSpring}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </motion.button>
  )
}
