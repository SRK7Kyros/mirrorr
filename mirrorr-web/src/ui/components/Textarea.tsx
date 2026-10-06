import type { ComponentPropsWithRef } from "react"
import { cn } from "@/ui/lib/cn"

export type TextareaProps = ComponentPropsWithRef<"textarea">

/** Monospace textarea (config/JSON editors) — `.textarea` from components.css. */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cn("textarea", className)} {...rest} />
}
