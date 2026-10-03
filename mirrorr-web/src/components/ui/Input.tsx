import { useId } from "react"
import type { ComponentPropsWithoutRef } from "react"
import { Spinner } from "./Spinner"

export interface InputProps extends Omit<ComponentPropsWithoutRef<"input">, "className" | "size"> {
  /** Label text — every input pairs a <label for> (§6.2). */
  readonly label: string
  /** Helper line under the field; when `error` is set it renders as the error line. */
  readonly helper?: string
  readonly error?: string
  /** §6.2 loading state — trailing spinner while a schema resolves. */
  readonly loading?: boolean
  /** mono rendering for id/hash/key fields. */
  readonly mono?: boolean
  readonly className?: string
  readonly fieldClassName?: string
}

/**
 * Input — §6.2 matrix: acrylic 0.72/16 or its opaque twin (assigned by the
 * ground beneath, §1.3) · hover brightens the keyline to `edge-near` ·
 * focus-visible = two-layer ring, never a glow · disabled · loading ·
 * error = 2px danger-deep underline + inline copy via aria-describedby /
 * aria-invalid · empty shows the #6E6E6E placeholder (5.10:1, never a label).
 */
export function Input({
  label,
  helper,
  error,
  loading = false,
  mono = false,
  className,
  fieldClassName,
  id,
  required,
  disabled,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const helperId = `${inputId}-helper`
  const hasError = error !== undefined && error.length > 0
  const helperText = hasError ? error : helper

  const inputClasses = [
    "input",
    "acrylic",
    "acrylic--input",
    hasError ? "input--error" : null,
    loading ? "input--loading" : null,
    mono ? "input--mono" : null,
    className,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")

  const fieldClasses = fieldClassName === undefined ? "field" : `field ${fieldClassName}`

  return (
    <div className={fieldClasses}>
      <label className="field__label" htmlFor={inputId}>
        {label}
        {required === true ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <span className="input-wrap">
        <input
          {...rest}
          id={inputId}
          className={inputClasses}
          disabled={disabled}
          required={required}
          aria-required={required === true ? true : undefined}
          aria-invalid={hasError || undefined}
          aria-busy={loading || undefined}
          aria-describedby={helperText !== undefined && helperText.length > 0 ? helperId : undefined}
        />
        {loading ? (
          <span className="input__spin" aria-hidden="true">
            <Spinner size="sm" />
          </span>
        ) : null}
      </span>
      {helperText !== undefined && helperText.length > 0 ? (
        <span id={helperId} className={hasError ? "field__helper field__helper--error" : "field__helper"}>
          {helperText}
        </span>
      ) : null}
    </div>
  )
}
