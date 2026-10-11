import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { IconAlert } from "./icons"

export interface FieldProps {
  readonly label?: ReactNode
  readonly htmlFor?: string
  readonly required?: boolean
  readonly hint?: ReactNode
  readonly error?: string | null
  readonly children: ReactNode
  readonly className?: string
}

export function Field({ label, htmlFor, required = false, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-2 min-w-0", className)}>
      {label !== undefined ? (
        <label className="flex items-center gap-2 text-sm font-medium text-ink-muted" htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error !== undefined && error !== null && error !== "" ? (
        <span className="flex items-center gap-1 text-sm text-danger" role="alert">
          <IconAlert size={13} />
          {error}
        </span>
      ) : hint !== undefined ? (
        <span className="text-sm text-ink-dim">{hint}</span>
      ) : null}
    </div>
  )
}