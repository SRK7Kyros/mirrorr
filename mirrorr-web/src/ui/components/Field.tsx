import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react"
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

interface ControlProps {
  readonly id?: string
  readonly required?: boolean
  readonly "aria-invalid"?: boolean | "true" | "false"
  readonly "aria-describedby"?: string
}

/**
 * Label + hint + error wrapper that wires the control it wraps: `aria-invalid`,
 * `aria-describedby` and `required` land on the child, so the message is part
 * of the field for assistive tech instead of a red sentence printed beside it.
 */
export function Field({ label, htmlFor, required = false, hint, error, children, className }: FieldProps) {
  const generatedId = useId()
  const messageId = useId()
  const hasError = error !== undefined && error !== null && error !== ""
  const child = isValidElement(children) ? (children as ReactElement<ControlProps>) : null
  const controlId = htmlFor ?? child?.props.id ?? generatedId
  const messageRef = hasError || hint !== undefined ? messageId : undefined
  const describedBy =
    [child?.props["aria-describedby"], messageRef].filter((value) => value !== undefined).join(" ") ||
    undefined

  const control =
    child === null
      ? children
      : cloneElement(child, {
          id: child.props.id ?? controlId,
          required: required || child.props.required === true,
          "aria-invalid": hasError ? true : child.props["aria-invalid"],
          "aria-describedby": describedBy,
        })

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {label !== undefined ? (
        <label className="flex items-center gap-2 text-sm font-medium text-ink-muted" htmlFor={controlId}>
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {control}
      {hasError ? (
        <span id={messageId} className="flex items-center gap-1 text-sm text-danger" role="alert">
          <IconAlert size={13} />
          {error}
        </span>
      ) : hint !== undefined ? (
        <span id={messageId} className="text-sm text-ink-dim">
          {hint}
        </span>
      ) : null}
    </div>
  )
}