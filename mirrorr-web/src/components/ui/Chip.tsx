import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"
import { micro } from "./motion-tokens"

export interface ChipProps {
  readonly children: ReactNode
  /** §6.3: selected = primary 2px left bar + press-scale toggle. */
  readonly selected?: boolean
  readonly onClick?: () => void
  /** §6.3: filter chips >=44px on coarse pointers (base.css upsizes them). */
  readonly icon?: ReactNode
  readonly disabled?: boolean
  /** §6.3: 1px danger-deep keyline. */
  readonly error?: boolean
  readonly className?: string
}

/**
 * Chip — §6.3 filter/tag chip: acrylic 0.55/8 on media (or its opaque twin
 * inside a panel), radius 4, pad 8×12, 16px label on acrylic / label-caps on
 * the opaque twin. Selection toggles on the `micro` token (scale 0.96) and
 * grows the primary left bar; disabled drops to 55%; error swaps in a
 * danger-deep keyline. Static chips render a span, actionable ones a button.
 */
export function Chip({
  children,
  selected = false,
  onClick,
  icon,
  disabled = false,
  error = false,
  className,
}: ChipProps) {
  const reduced = useReducedMotion()

  const classes = [
    "chip",
    "acrylic",
    "acrylic--chip",
    "acrylic--r-sm",
    selected ? "chip--selected" : null,
    disabled ? "chip--disabled" : null,
    error ? "chip--error" : null,
    onClick !== undefined ? "chip--button" : "chip--static",
    className,
  ]
    .filter((part) => part !== null)
    .join(" ")

  const inner = (
    <>
      {icon !== undefined ? (
        <span className="chip__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="chip__label">{children}</span>
    </>
  )

  if (onClick === undefined) {
    return (
      <span className={classes} data-selected={selected || undefined} data-error={error || undefined}>
        {inner}
      </span>
    )
  }

  return (
    <motion.button
      type="button"
      className={classes}
      data-selected={selected || undefined}
      data-error={error || undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled || reduced === true ? undefined : { scale: 0.96 }}
      transition={micro}
    >
      {inner}
    </motion.button>
  )
}
