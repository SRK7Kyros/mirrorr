import type { ReactNode } from "react"

export interface EmptyStateProps {
  /** §6.5/§11.6: label-caps eyebrow — max one per view. */
  readonly eyebrow?: string
  readonly headline: string
  /** 16px body, ≤25 words (§6.5). */
  readonly body: string
  /** Primary CTA + at most one secondary (§6.5). */
  readonly action?: ReactNode
  readonly icon?: ReactNode
  readonly className?: string
}

/**
 * EmptyState — §6.5: opaque panel, label-caps eyebrow, 16px body, one primary
 * CTA. This IS the empty form of a surface: composed from the view's copy,
 * never lorem. Render inside the region it replaces; the caller owns any
 * `role="status"` wrapper.
 */
export function EmptyState({ eyebrow, headline, body, action, icon, className }: EmptyStateProps) {
  const classes = className === undefined ? "empty" : `empty ${className}`

  return (
    <div className={classes}>
      {icon !== undefined ? <span className="empty__icon">{icon}</span> : null}
      {eyebrow !== undefined ? <p className="empty__eyebrow">{eyebrow}</p> : null}
      <p className="empty__headline">{headline}</p>
      <p className="empty__body">{body}</p>
      {action !== undefined ? <div className="empty__action">{action}</div> : null}
    </div>
  )
}
