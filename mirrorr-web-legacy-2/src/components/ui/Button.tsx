import type { LucideIcon } from "lucide-react"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { FOCUS_RING } from "@/components/ui/focus-ring"

/**
 * Button — the four spec variants (docs/web-frontend-spec.md L107):
 * primary/danger fill with `--bg-base` text (white fails AA), secondary
 * `bg-overlay` + border, ghost with no fill. Disabled = 40% opacity and no
 * pointer. Height 32px, radius 4.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"
export type ButtonSize = "control" | "sm"
export type ButtonIconSize = "default" | "row"

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg-base hover:bg-accent-hover active:brightness-[0.92]",
  secondary: "border border-border bg-bg-overlay text-text-primary hover:bg-bg-raised",
  danger: "bg-danger text-bg-base active:brightness-[0.92]",
  ghost: "text-text-secondary hover:text-text-primary",
}

const SIZES: Record<ButtonSize, string> = {
  control: "h-8 text-body",
  sm: "h-6 text-small",
}

const ICON_ONLY_WIDTHS: Record<ButtonSize, string> = {
  control: "w-8",
  sm: "w-6",
}

const ICON_SIZES: Record<ButtonIconSize, string> = {
  default: "size-[var(--icon-default)]",
  row: "size-[var(--icon-row)]",
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly icon?: LucideIcon
  readonly iconSize?: ButtonIconSize
  readonly children?: ReactNode
}

export function Button({
  variant = "secondary",
  size = "control",
  icon: Icon,
  iconSize = "default",
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined || children === null

  const classes = [
    "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-[var(--motion-fast)] ease-out disabled:pointer-events-none disabled:opacity-40",
    FOCUS_RING,
    VARIANTS[variant],
    SIZES[size],
    iconOnly ? ICON_ONLY_WIDTHS[size] : "px-3",
    className ?? "",
  ].join(" ")

  return (
    <button type={type} className={classes} {...rest}>
      {Icon ? (
        <Icon aria-hidden="true" strokeWidth={2} className={ICON_SIZES[iconSize]} />
      ) : null}
      {children}
    </button>
  )
}
