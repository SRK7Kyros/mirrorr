import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import type { ButtonSize, ButtonVariant } from "./Button"

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Accessible name — required (the icon alone carries no text). */
  readonly label: string
  readonly icon: ReactNode
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly type?: "button" | "submit" | "reset"
}

/** Square icon-only button — `.btn .btn-icon` + `aria-label`. */
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
      aria-label={label}
      title={label}
      className={cn("btn", `btn-${variant}`, "btn-icon", size !== "md" && `btn-${size}`, className)}
    >
      {icon}
    </button>
  )
}
