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

/**
 * Form field wrapper — label / control / hint / error. `error` is announced
 * via `role="alert"` and the control should set `aria-invalid` itself.
 */
export function Field({ label, htmlFor, required = false, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("field", className)}>
      {label !== undefined ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="field-req" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error !== undefined && error !== null && error !== "" ? (
        <span className="field-error" role="alert">
          <IconAlert size={13} />
          {error}
        </span>
      ) : hint !== undefined ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  )
}
