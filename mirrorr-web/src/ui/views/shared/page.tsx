import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface PageProps {
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * Page scaffolding — the `.page` column every view renders into, with the
 * optional title/description/actions head. Views own their own body.
 */
export function Page({ title, description, actions, children, className }: PageProps) {
  return (
    <main className={cn("page", className)}>
      {title !== undefined ? (
        <div className="page-head">
          <div className="page-head-text">
            <h1 className="page-title">{title}</h1>
            {description !== undefined ? <p className="page-desc">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="page-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </main>
  )
}
