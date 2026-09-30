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
  /** Accessible announcement — never glyph+number color alone (§7). */
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

/** §4 unread: counts ≥10 collapse to "9+". */
function formatUnread(children: ReactNode): ReactNode {
  if (typeof children === "number" && children >= 10) {
    return "9+"
  }
  return children
}

/**
 * Badge — §4 variants: unread count (min 16×16, r4, danger bg, inverse fg),
 * capability false/true, admin/user role, tag. solid_fg `#09090b` for
 * solid fills; tints + fg hexes ride the §2 re-bindings in tokens.css.
 */
export function Badge({ variant, children, className, ...aria }: BadgeProps) {
  const content = variant === "unread" ? formatUnread(children) : children
  const classes = className === undefined ? variantClass[variant] : `${variantClass[variant]} ${className}`

  return (
    <span className={classes} {...aria}>
      {content}
    </span>
  )
}
