import { useId, type InputHTMLAttributes } from "react"
import { FOCUS_RING } from "@/components/ui/focus-ring"

/**
 * Input — spec L108: bg-base, border, radius 4, 32px height, 13px; focus is
 * border-strong + the 2px accent ring; an error paints the danger border and a
 * 12px danger message below, wired with `aria-describedby` + `aria-invalid`
 * (spec L478). The label is always paired (axe-clean by construction).
 */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string
  readonly id?: string
  readonly error?: string
}

export function Input({ label, id, error, className, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={inputId} className="text-label text-text-secondary">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        className={[
          "h-8 w-full rounded-control border bg-bg-base px-2 text-body text-text-primary placeholder:text-text-muted focus:border-border-strong",
          error !== undefined ? "border-danger" : "border-border",
          FOCUS_RING,
          className ?? "",
        ].join(" ")}
        {...rest}
      />
      {error !== undefined ? (
        <p id={errorId} className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
