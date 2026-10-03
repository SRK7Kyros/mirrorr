import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"
import { micro } from "./motion-tokens"

export interface NavItemProps {
  readonly label: string
  readonly icon?: ReactNode
  /** §6.5: active = primary 2px bar + weight-ui label. */
  readonly active?: boolean
  readonly href?: string
  readonly onClick?: () => void
  /** Non-admins see only permitted destinations — absent, never disabled. */
  readonly className?: string
}

/**
 * NavItem — §6.5: 44px row for the rail (bar variant), spine (pill variant) or
 * tab strip (bottom bar). Active gets the primary 2px left bar and a
 * weight-ui label; inactive label is #141414@90% (4.59:1 worst-case acrylic)
 * shading to full #141414 on hover; press uses the `micro` token. The active
 * indicator's `layoutId` slide is a shell concern and is deliberately not
 * implemented here.
 */
export function NavItem({ label, icon, active = false, href, onClick, className }: NavItemProps) {
  const reduced = useReducedMotion()
  const classes = ["nav-item", active ? "nav-item--active" : null, className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  const content = (
    <>
      <span className="nav-item__indicator" aria-hidden="true" />
      {icon !== undefined ? (
        <span className="nav-item__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="nav-item__label">{label}</span>
    </>
  )

  if (href !== undefined) {
    return (
      <a className={classes} href={href} aria-current={active ? "page" : undefined} onClick={onClick}>
        {content}
      </a>
    )
  }

  return (
    <motion.button
      type="button"
      className={classes}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      whileTap={reduced === true ? undefined : { scale: 0.96 }}
      transition={micro}
    >
      {content}
    </motion.button>
  )
}
