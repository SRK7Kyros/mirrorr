import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { Spinner } from "./Spinner"

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "danger-ghost"

export type ButtonSize = "sm" | "md" | "lg"

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly block?: boolean
  readonly icon?: ReactNode
  readonly loading?: boolean
  readonly type?: "button" | "submit" | "reset"
}

/**
 * The one button primitive. Variants bind `.btn-<variant>`; `primary` is
 * reserved for the single filled accent action per view (design-system rule).
 */
export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  icon,
  loading = false,
  type = "button",
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cn(
        "btn",
        `btn-${variant}`,
        size !== "md" && `btn-${size}`,
        block && "btn-block",
        className,
      )}
      disabled={disabled === true || loading}
    >
      {loading ? <Spinner /> : icon}
      {children !== undefined && children !== null ? <span>{children}</span> : null}
    </button>
  )
}
