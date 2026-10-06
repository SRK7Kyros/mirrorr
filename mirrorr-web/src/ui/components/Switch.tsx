import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface SwitchProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  readonly label?: ReactNode
  readonly className?: string
}

/**
 * Toggle — `.switch` + `.switch-track`. The input is visually hidden by the
 * track's sibling selector; keep it in the DOM for form semantics.
 */
export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={cn("switch", className)}>
      <input type="checkbox" role="switch" className="sr-only" {...rest} />
      <span className="switch-track" aria-hidden="true" />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}
