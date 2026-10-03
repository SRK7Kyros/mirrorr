import { motion, useReducedMotion } from "motion/react"
import type { HTMLMotionProps } from "motion/react"
import type { ReactNode } from "react"
import { micro } from "./motion-tokens"
import { Spinner } from "./Spinner"

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "destructive"
  | "danger-text"

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  readonly variant?: ButtonVariant
  /** Shows a spinner in place of `icon`; label + width stay frozen (§6.1). */
  readonly loading?: boolean
  /** Leading glyph replaced by the spinner while loading. */
  readonly icon?: ReactNode
  /** §6.1 error state — primary/danger flash to danger-deep; secondary keyline. */
  readonly error?: boolean
  readonly children?: ReactNode
}

/**
 * Button — §6.1 matrix: primary (one per view) · secondary (acrylic 0.64/16 or
 * its opaque twin) · ghost (icon) · dangerous pair (`danger` = danger-deep
 * fill; `danger-text` = quiet). States: default · hover · active
 * (whileTap scale 0.96, `micro`) · focus-visible (two-layer ring §8.3) ·
 * disabled · loading · error. Acrylic is applied through the reusable
 * `.acrylic--card` recipe so `prefers-reduced-transparency` degrades it.
 */
export function Button({
  variant = "primary",
  loading = false,
  icon,
  error = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const reduced = useReducedMotion()
  const resolved = variant === "destructive" ? "danger" : variant
  const acrylic = resolved === "secondary" ? "acrylic acrylic--card acrylic--r-sm" : null

  const classes = ["btn", `btn--${resolved}`, acrylic, loading ? "btn--loading" : null, className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return (
    <motion.button
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-error={error || undefined}
      whileTap={disabled === true || loading || reduced === true ? undefined : { scale: 0.96 }}
      transition={micro}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children !== undefined ? <span className="btn__label">{children}</span> : null}
    </motion.button>
  )
}
