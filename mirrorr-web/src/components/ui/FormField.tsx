import type { ReactNode } from "react"

export interface FormFieldProps {
  readonly label: string
  readonly htmlFor: string
  readonly required?: boolean
  /** §6.2: helper sits 8px under the control and wraps at the 68ch measure. */
  readonly helper?: string
  /** Error replaces the helper line and is wired through aria-describedby upstream. */
  readonly error?: string
  readonly children: ReactNode
  readonly className?: string
}

/**
 * FormField — §6.2: body-md 16/500 label above the control (8px gap), helper
 * or error line below (8px gap), required marker `*` doubled by aria-required.
 * Use it to wrap controls that do not carry their own label slot (schema
 * widgets, custom pickers). Capsules and opaque panels already define their
 * own layouts; this adds no width opinion.
 */
export function FormField({ label, htmlFor, required = false, helper, error, children, className }: FormFieldProps) {
  const hasError = error !== undefined && error.length > 0
  const helperText = hasError ? error : helper
  const classes = className === undefined ? "form-field" : `form-field ${className}`

  return (
    <div className={classes}>
      <label className="form-field__label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {helperText !== undefined && helperText.length > 0 ? (
        <span className={hasError ? "form-field__helper form-field__helper--error" : "form-field__helper"}>
          {helperText}
        </span>
      ) : null}
    </div>
  )
}

export interface FieldsetProps {
  /** Rendered as the label-caps legend on the opaque chrome strip. */
  readonly legend: string
  /** Supporting line (≤68ch): why these options exist, defaults, caveats. */
  readonly note?: string
  readonly disabled?: boolean
  /** §6.2: when the whole group is disabled the helper explains why. */
  readonly disabledReason?: string
  readonly children: ReactNode
  readonly className?: string
}

/**
 * Fieldset — §6.2: label-caps legend on an opaque chrome strip, `focus-within`
 * takes the two-layer ring so grouped controls read as one target, and a
 * disabled group freezes every child while the helper carries the reason.
 */
export function Fieldset({ legend, note, disabled = false, disabledReason, children, className }: FieldsetProps) {
  const classes = className === undefined ? "fieldset" : `fieldset ${className}`

  return (
    <fieldset className={classes} disabled={disabled}>
      <legend className="fieldset__legend t-label-caps">{legend}</legend>
      {note !== undefined ? <p className="fieldset__note">{note}</p> : null}
      <div className="fieldset__body">{children}</div>
      {disabled && disabledReason !== undefined ? (
        <p className="fieldset__reason">{disabledReason}</p>
      ) : null}
    </fieldset>
  )
}
