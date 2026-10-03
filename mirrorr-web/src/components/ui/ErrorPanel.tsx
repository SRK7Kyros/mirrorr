import type { ReactNode } from "react"

export interface ErrorPanelProps {
  /** Failure headline — often a request id; styled normally by CSS (§6.5). */
  readonly title: string
  readonly body?: string
  readonly actions?: ReactNode
  /** Leading danger-deep icon; defaults to none so callers pass their own. */
  readonly icon?: ReactNode
  /** Mono "Details" disclosure payload (opaque block). */
  readonly details?: string
  /** Table row-level variant: compact padding, body + actions inline (§6.4). */
  readonly row?: boolean
  readonly className?: string
}

/**
 * ErrorPanel — §6.5: opaque panel, danger-deep 3px left bar + icon + #141414
 * copy (18.42:1) + Retry secondary + optional Details disclosure. Red text is
 * banned (hard law 7), so the copy stays `#141414` and colour rides the bar
 * and icon. `role="alert"` announces failures (§8.5).
 */
export function ErrorPanel({ title, body, actions, icon, details, row = false, className }: ErrorPanelProps) {
  const classes = ["error-panel", row ? "error-panel--row" : null, className]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  return (
    <div role="alert" className={classes}>
      {icon !== undefined ? <span className="error-panel__icon">{icon}</span> : null}
      <p className="error-panel__title">{title}</p>
      {body !== undefined && body.length > 0 ? <p className="error-panel__body">{body}</p> : null}
      {details !== undefined && details.length > 0 ? (
        <details className="error-panel__details">
          <summary>Details</summary>
          <pre>{details}</pre>
        </details>
      ) : null}
      {actions !== undefined ? <div className="error-panel__actions">{actions}</div> : null}
    </div>
  )
}
