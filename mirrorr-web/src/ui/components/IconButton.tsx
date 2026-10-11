import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { iconButtonClass, type ButtonSize, type ButtonVariant } from "./Button"

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Accessible name — required (the icon alone carries no text). */
  readonly label: string
  readonly icon: ReactNode
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly type?: "button" | "submit" | "reset"
}

/** Square icon-only button — the icon flavour of `Button` plus `aria-label`. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      data-slot="button"
      aria-label={label}
      title={label}
      className={cn(iconButtonClass({ variant, size }), className)}
    >
      {icon}
    </button>
  )
}