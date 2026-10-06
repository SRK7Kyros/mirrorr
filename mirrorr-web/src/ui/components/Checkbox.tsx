import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
  readonly className?: string
}

/** Checkbox — `.check` wrapper styles the native box; the input stays native. */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn("check", className)}>
      <input type="checkbox" {...rest} />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}

export interface RadioProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
}

export function Radio({ label, className, ...rest }: RadioProps) {
  return (
    <label className={cn("check", className)}>
      <input type="radio" {...rest} />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}
