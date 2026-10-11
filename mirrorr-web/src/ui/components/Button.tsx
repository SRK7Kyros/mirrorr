import { cva } from "class-variance-authority"
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

/**
 * Per-property durations from `tokens.css`: `transform` is deliberately faster
 * (`--dur-instant`) than the colour fades (`--dur-fast`), so the shorthand is
 * written out instead of using `transition-colors`.
 */
const TRANSITION =
  "[transition:background_var(--dur-fast)_var(--ease-out),border-color_var(--dur-fast)_var(--ease-out),color_var(--dur-fast)_var(--ease-out),transform_var(--dur-instant)_var(--ease-out)]"

const BUTTON_BASE = [
  "inline-flex items-center justify-center gap-2",
  "rounded-sm border leading-none whitespace-nowrap select-none",
  "[&:active:not(:disabled)]:scale-[0.975] disabled:opacity-45",
  TRANSITION,
].join(" ")

/**
 * Each variant declares its own border colour, background, text colour and
 * weight in full, so no two utilities ever target the same property. That keeps
 * the result independent of Tailwind's internal utility ordering — a base
 * `bg`/`font` that a variant merely overrides would not be reliable.
 */
const BUTTON_VARIANT = {
  primary:
    "border-transparent bg-brand text-brand-ink font-semibold shadow-elev-xs [&:hover:not(:disabled)]:bg-brand-hover [&:active:not(:disabled)]:bg-brand-press",
  secondary:
    "border-line bg-surface-3 text-ink font-medium [&:hover:not(:disabled)]:border-line-strong [&:hover:not(:disabled)]:bg-surface-4",
  outline:
    "border-line-strong bg-transparent text-ink font-medium [&:hover:not(:disabled)]:border-ink-faint [&:hover:not(:disabled)]:bg-surface-2",
  ghost:
    "border-transparent bg-transparent text-ink-muted font-medium [&:hover:not(:disabled)]:bg-surface-2 [&:hover:not(:disabled)]:text-ink",
  danger: "border-transparent bg-danger text-white font-semibold [&:hover:not(:disabled)]:brightness-110",
  "danger-ghost":
    "border-line bg-transparent text-danger font-medium [&:hover:not(:disabled)]:border-danger [&:hover:not(:disabled)]:bg-danger-dim",
} as const

/** Text-button heights/tints — `--btn-h` 28 / 34 / 42. */
const BUTTON_SIZE = {
  sm: "h-7 px-2 text-sm",
  md: "h-[34px] px-3 text-base",
  lg: "h-[42px] px-5 text-md",
} as const

/** Icon buttons square off at 28 / 34 / 40 (note `lg` is 40px, not 42px). */
const ICON_SIZE = {
  sm: "h-7 w-7",
  md: "h-[34px] w-[34px]",
  lg: "h-10 w-10",
} as const

export const buttonClass = cva([BUTTON_BASE], {
  variants: {
    variant: BUTTON_VARIANT,
    size: BUTTON_SIZE,
    block: { true: "w-full" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
})

export const iconButtonClass = cva([BUTTON_BASE, "px-0"], {
  variants: { variant: BUTTON_VARIANT, size: ICON_SIZE },
  defaultVariants: { variant: "ghost", size: "md" },
})

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly block?: boolean
  readonly icon?: ReactNode
  readonly loading?: boolean
  readonly type?: "button" | "submit" | "reset"
}

/**
 * The one button primitive. `primary` is reserved for the single filled accent
 * action per view (design-system rule).
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
      data-slot="button"
      className={cn(buttonClass({ variant, size, block }), className)}
      disabled={disabled === true || loading}
    >
      {loading ? <Spinner /> : icon}
      {children !== undefined && children !== null ? <span data-slot="button-label">{children}</span> : null}
    </button>
  )
}