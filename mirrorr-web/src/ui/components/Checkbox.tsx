import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
  readonly className?: string
  /** Tri-state "some but not all": set imperatively, never as an `indeterminate` attribute. */
  readonly indeterminate?: boolean
}

const WRAP_CLASS = "inline-flex items-center gap-2 cursor-pointer text-base p-1 -m-1"
const CHECK_CLASS = "check-input tab-stop"

export function Checkbox({ label, className, indeterminate = false, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className={cn(WRAP_CLASS, className)}>
      <input ref={ref} type="checkbox" className={CHECK_CLASS} {...rest} />
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