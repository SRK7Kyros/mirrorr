import type { ReactNode } from "react"

export interface ErrorPanelProps {
  /** `Machine text` — often a request id; styled normally by CSS (§9). */
  readonly title: string
  readonly body?: string
  readonly actions?: ReactNode
  /** Table row-level variant: compact padding, body + actions inline (§4). */
  readonly row?: boolean
  readonly className?: string
}

/**
 * ErrorPanel — §4: bg rgba(239,68,68,0.08), border rgba(239,68,68,0.35),
 * fg #FF6B77 (tokens.css --error-*), r8, pad16, title 14/500, body 12,
 * actions ghost. role="alert" so failures are announced (§7 live regions);
 * <details> collapse when a payload is attached.
 */
export function ErrorPanel({ title, body, actions, row = false, className }: ErrorPanelProps) {
  const classes = [
    "error-panel",
    row ? "error-panel--row" : null,
    className,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ")

  return (
    <div role="alert" className={classes}>
      <p className="error-panel__title">{title}</p>
      {body !== undefined && body.length > 0 ? <p className="error-panel__body">{body}</p> : null}
      {actions !== undefined ? <div className="error-panel__actions">{actions}</div> : null}
    </div>
  )
}
