import type { ComponentPropsWithRef } from "react"
import { cn } from "@/ui/lib/cn"
import { controlClass } from "./control"

export type TextareaProps = ComponentPropsWithRef<"textarea">

export function Textarea({ className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cn(
        controlClass,
        "h-auto min-h-[84px] py-2 px-3 text-sm leading-normal resize-y [font-family:var(--font-mono)]",
        className,
      )}
      {...rest}
    />
  )
}