import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface PanelProps {
  readonly children: ReactNode
  readonly className?: string
}

/** Bordered surface — `.panel` from components.css. */
export function Panel({ children, className }: PanelProps) {
  return <section className={cn("panel", className)}>{children}</section>
}

export interface PanelHeadProps {
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

export function PanelHead({ title, actions, children, className }: PanelHeadProps) {
  return (
    <header className={cn("panel-head", className)}>
      {title !== undefined ? <h2 className="panel-title">{title}</h2> : null}
      {children}
      {actions !== undefined ? <div className="row">{actions}</div> : null}
    </header>
  )
}

export function PanelBody({
  children,
  flush = false,
  className,
}: {
  readonly children: ReactNode
  readonly flush?: boolean
  readonly className?: string
}) {
  return <div className={cn("panel-body", flush && "panel-body-flush", className)}>{children}</div>
}

export function PanelFoot({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <footer className={cn("panel-foot", className)}>{children}</footer>
}
