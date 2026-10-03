import type { ReactNode } from "react"

export type BadgeVariant =
  | "unread"
  | "capability"
  | "capability-true"
  | "role-admin"
  | "role-user"
  | "tag"

export interface BadgeProps {
  readonly variant: BadgeVariant
  readonly children: ReactNode
  /** §6.3: focus ring + press feedback when the badge opens the drawer. */
  readonly interactive?: boolean
  /** §6.3: failure counts fill danger-deep instead of primary. */
  readonly error?: boolean
  /** Accessible announcement — never glyph+number colour alone (§8.5). */
  readonly "aria-label"?: string
  readonly className?: string
}

const variantClass: Record<BadgeVariant, string> = {
  unread: "badge badge--unread",
  capability: "badge badge--capability",
  "capability-true": "badge badge--capability-true",
  "role-admin": "badge badge--role-admin",
  "role-user": "badge badge--role-user",
  tag: "badge badge--tag",
}

/** §6.3/§11.28: 0 renders nothing (never "0"); ≥10 collapses to "9+". */
function formatCount(children: ReactNode): ReactNode {
  if (typeof children !== "number") return children
  if (children <= 0) return null
  return children >= 10 ? "9+" : children
}

/**
 * Badge — §6.3 count badge is the primary fill (white tabular label, 5.51:1);
 * role/capability/tag variants are the subtle opaque chips. Empty is hidden,
 * not "0" (§11.28).
 */
export function Badge({ variant, children, interactive = false, error = false, className, ...aria }: BadgeProps) {
  const content = variant === "unread" ? formatCount(children) : children
  if (content === null) return null

  const classes = [
    variantClass[variant],
    interactive ? "badge--action" : null,
    error ? "badge--danger" : null,
    className,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return (
    <span className={classes} {...aria}>
      {content}
    </span>
  )
}
