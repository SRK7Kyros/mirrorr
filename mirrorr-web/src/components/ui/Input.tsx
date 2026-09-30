import { useId } from "react"
import type { ComponentPropsWithoutRef } from "react"

export interface InputProps extends Omit<ComponentPropsWithoutRef<"input">, "className" | "size"> {
  /** Label text — every input pairs a <label for> (§7 forms). */
  readonly label: string
  /** Helper line under the field; when `error` is set it renders as the error line. */
  readonly helper?: string
  readonly error?: string
  /** mono-inline rendering for id/hash/key fields (§4 filled row). */
  readonly mono?: boolean
  readonly className?: string
  readonly fieldClassName?: string
}

/**
 * Input — §4 matrix: default · hover (border-strong) · focus (ring +
 * accent-text border) · filled · disabled · error (danger border +
 * aria-describedby helper) · required (`*` suffix + aria-required).
 * Compact (≤639): h44 + 16px text via chrome.css.
 */
export function Input({
  label,
  helper,
  error,
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
    hasError ? "input--error" : null,
    mono ? "input--mono" : null,
    className,
  ]
    .filter((part) => part !== null && part !== "")
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
      <input
        {...rest}
        id={inputId}
        className={inputClasses}
        disabled={disabled}
        required={required}
        aria-required={required === true ? true : undefined}
        aria-invalid={hasError || undefined}
        aria-describedby={helperText !== undefined && helperText.length > 0 ? helperId : undefined}
      />
      {helperText !== undefined && helperText.length > 0 ? (
        <span
          id={helperId}
          className={hasError ? "field__helper field__helper--error" : "field__helper"}
        >
          {helperText}
        </span>
      ) : null}
    </div>
  )
}
