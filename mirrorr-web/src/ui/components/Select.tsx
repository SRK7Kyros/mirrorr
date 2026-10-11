import type { ComponentPropsWithRef, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { controlClass } from "./control"

export interface SelectProps extends Omit<ComponentPropsWithRef<"select">, "children"> {
  readonly children: ReactNode
}

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cn(controlClass, "h-9 px-3 pr-8 text-base appearance-none select-chevron", className)} {...rest}>
      {children}
    </select>
  )
}