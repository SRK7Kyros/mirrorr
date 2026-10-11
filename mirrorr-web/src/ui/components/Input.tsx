import type { ComponentPropsWithRef } from "react"
import { cn } from "@/ui/lib/cn"
import { controlClass } from "./control"

export type InputProps = ComponentPropsWithRef<"input">

export function Input({ className, ...rest }: InputProps) {
  return <input className={cn(controlClass, "h-9 px-3 text-base", className)} {...rest} />
}