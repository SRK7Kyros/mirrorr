import type { ReactNode } from "react"

export interface EmptyStateProps {
  readonly headline: string
  readonly body: string
  /** Single primary action — spec §4: never two competing buttons. */
  readonly action?: ReactNode
  readonly icon?: ReactNode
  readonly className?: string
}

/**
 * EmptyState — §4: centered column, max-width 360, icon muted,
 * headline 20/600, body 14 secondary, one optional primary CTA 16px below.
 * Render inside the region it replaces (tbody region gets role="status" on
 * the caller's wrapper, not here — the content itself is static copy).
 */
export function EmptyState({ headline, body, action, icon, className }: EmptyStateProps) {
  const classes = className === undefined ? "empty" : `empty ${className}`

  return (
    <div className={classes}>
      {icon !== undefined ? <span className="empty__icon">{icon}</span> : null}
      <p className="empty__headline t-h2">{headline}</p>
      <p className="empty__body">{body}</p>
      {action !== undefined ? <div className="empty__action">{action}</div> : null}
    </div>
  )
}
