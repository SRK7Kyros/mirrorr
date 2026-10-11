import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface SwitchProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
  readonly className?: string
}

export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={cn("inline-flex items-center gap-3 cursor-pointer", className)}>
      <input type="checkbox" role="switch" className="sr-only peer" {...rest} />
      <span className="switch-track" aria-hidden="true" />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}