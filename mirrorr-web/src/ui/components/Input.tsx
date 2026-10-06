import type { ComponentPropsWithRef } from "react"
import { cn } from "@/ui/lib/cn"

export type InputProps = ComponentPropsWithRef<"input">

/** Text input — `.input` from components.css. Ref forwards to the element. */
export function Input({ className, ...rest }: InputProps) {
  return <input className={cn("input", className)} {...rest} />
}

export interface InputGroupProps {
  readonly children: React.ReactNode
  readonly className?: string
}

/** `.input-group` — input flush against a trailing button. */
export function InputGroup({ children, className }: InputGroupProps) {
  return <div className={cn("input-group", className)}>{children}</div>
}
