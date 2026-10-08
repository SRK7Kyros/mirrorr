import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface PageProps {
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

interface HeadProps {
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly level: "h1" | "h2"
}

function Head({ title, description, actions, level }: HeadProps) {
  if (title === undefined) return null
  return (
    <div className="page-head">
      <div className="page-head-text">
        {level === "h1" ? (
          <h1 className="page-title">{title}</h1>
        ) : (
          <h2 className="section-title">{title}</h2>
        )}
        {description !== undefined ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions !== undefined ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}

/**
 * Page scaffolding — the `.page` column every view renders into, with the
 * optional title/description/actions head. Views own their own body.
 */
export function Page({ title, description, actions, children, className }: PageProps) {
  return (
    <main className={cn("page", className)}>
      <Head title={title} description={description} actions={actions} level="h1" />
      {children}
    </main>
  )
}

/**
 * Section scaffolding — a titled block stacked inside a `Page`, used when a
 * single view holds more than one list (e.g. profiles + sources).
 */
export function Section({ title, description, actions, children, className }: PageProps) {
  return (
    <section className={cn("page-section", className)}>
      <Head title={title} description={description} actions={actions} level="h2" />
      {children}
    </section>
  )
}
