import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { Button } from "./Button"
import { IconAlert, IconInfo } from "./icons"

export type BannerKind = "neutral" | "warning" | "danger" | "info"

const BANNER_BASE = "flex items-center gap-3 py-3 px-4 rounded-md border text-base"

const BANNER_KIND = {
  neutral: "border-line bg-surface-2",
  warning: "[border-color:rgba(227,179,65,0.35)] bg-warning-dim",
  danger: "[border-color:rgba(248,81,73,0.35)] bg-danger-dim",
  info: "[border-color:rgba(88,166,255,0.3)] bg-info-dim",
} as const

const BANNER_ICON_KIND = {
  neutral: "",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
} as const

const BANNER_BODY = "flex-1 min-w-0"

const BANNER_TITLE = "font-semibold"

const BANNER_TEXT = "text-ink-muted text-sm selectable"

export interface BannerProps {
  readonly kind?: BannerKind
  readonly title?: ReactNode
  readonly children?: ReactNode
  readonly icon?: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}

const DEFAULT_ICON: Record<BannerKind, ReactNode> = {
  neutral: null,
  warning: <IconAlert size={16} />,
  danger: <IconAlert size={16} />,
  info: <IconInfo size={16} />,
}

/** Inline message bar. */
export function Banner({ kind = "neutral", title, children, icon, action, className }: BannerProps) {
  const resolvedIcon = icon !== undefined ? icon : DEFAULT_ICON[kind]
  return (
    <div className={cn(BANNER_BASE, BANNER_KIND[kind], className)} role="status">
      {resolvedIcon !== null ? (
        <span className={cn("shrink-0", BANNER_ICON_KIND[kind])} aria-hidden="true">
          {resolvedIcon}
        </span>
      ) : null}
      <div className={BANNER_BODY}>
        {title !== undefined ? <div className={BANNER_TITLE}>{title}</div> : null}
        {children !== undefined ? <div className={BANNER_TEXT}>{children}</div> : null}
      </div>
      {action}
    </div>
  )
}

export interface ErrorPanelProps {
  readonly message: string
  readonly onRetry?: () => void
  readonly retryLabel?: string
}

/** Standard query-error state — one retry action, shared copy. */
export function ErrorPanel({ message, onRetry, retryLabel = "Retry" }: ErrorPanelProps) {
  return (
    <Banner
      kind="danger"
      title="Something went wrong"
      action={onRetry !== undefined ? <Button size="sm" variant="outline" onClick={onRetry}>{retryLabel}</Button> : undefined}
    >
      {message}
    </Banner>
  )
}