import { useId, type SelectHTMLAttributes } from "react"
import { FOCUS_RING } from "@/components/ui/focus-ring"

/** Select — same geometry and error contract as Input (spec L108). */

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  readonly label: string
  readonly id?: string
  readonly error?: string
}

export function Select({ label, id, error, className, children, ...rest }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const errorId = `${selectId}-error`

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={selectId} className="text-label text-text-secondary">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={[
          "h-8 w-full rounded-control border bg-bg-base px-2 text-body text-text-primary focus:border-border-strong",
          error !== undefined ? "border-danger" : "border-border",
          FOCUS_RING,
          className ?? "",
        ].join(" ")}
        {...rest}
      >
        {children}
      </select>
      {error !== undefined ? (
        <p id={errorId} className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
