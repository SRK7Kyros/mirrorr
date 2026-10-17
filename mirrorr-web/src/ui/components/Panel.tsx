import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

/** Bordered surface shell. */
export const panelClass = "bg-surface-1 border border-line rounded-md overflow-hidden"

export const panelHeadClass =
  "flex items-center justify-between gap-3 py-3 px-4 border-b border-line-subtle min-h-12"

/** Shared by `PanelHead`'s title and by views that render a section sub-title. */
export const panelTitleClass = "flex items-center gap-2 text-md font-semibold leading-tight"

export const panelBodyClass = "p-4"

export const panelFootClass =
  "flex items-center justify-end gap-2 py-3 px-4 border-t border-line-subtle bg-surface-2"

export interface PanelProps extends Omit<ComponentPropsWithRef<"section">, "children"> {
  readonly children: ReactNode
}

/** Bordered surface — the panel shell. */
export function Panel({ children, className, ...rest }: PanelProps) {
  return (
    <section className={cn(panelClass, className)} {...rest}>
      {children}
    </section>
  )
}

export interface PanelHeadProps {
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

export function PanelHead({ title, actions, children, className }: PanelHeadProps) {
  return (
    <header className={cn(panelHeadClass, className)}>
      {title !== undefined ? <h2 className={panelTitleClass}>{title}</h2> : null}
      {children}
      {actions !== undefined ? <div className="flex items-center gap-3">{actions}</div> : null}
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
  return <div className={cn(flush ? "p-0" : panelBodyClass, className)}>{children}</div>
}

export function PanelFoot({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <footer className={cn(panelFootClass, className)}>{children}</footer>
}