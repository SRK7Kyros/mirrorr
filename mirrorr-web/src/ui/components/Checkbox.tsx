import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
  readonly className?: string
}

const WRAP_CLASS = "inline-flex items-center gap-2 cursor-pointer text-base"
const CHECK_CLASS = "check-input tab-stop"

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn(WRAP_CLASS, className)}>
      <input type="checkbox" className={CHECK_CLASS} {...rest} />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}

export interface RadioProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
}

export function Radio({ label, className, ...rest }: RadioProps) {
  return (
    <label className={cn(WRAP_CLASS, className)}>
      <input type="radio" className={CHECK_CLASS} {...rest} />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}