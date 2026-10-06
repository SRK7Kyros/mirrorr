import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "children"> {
  readonly children: ReactNode
}

/** Native select with a custom chevron — `.select` from components.css. */
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cn("select", className)} {...rest}>
      {children}
    </select>
  )
}
