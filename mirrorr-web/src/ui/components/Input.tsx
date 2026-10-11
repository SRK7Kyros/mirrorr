import type { ComponentPropsWithRef } from "react"
import { cn } from "@/ui/lib/cn"

export type InputProps = ComponentPropsWithRef<"input">

/** Text input — `.input` from components.css. Ref forwards to the element. */
export function Input({ className, ...rest }: InputProps) {
  return <input className={cn("input", className)} {...rest} />
}
