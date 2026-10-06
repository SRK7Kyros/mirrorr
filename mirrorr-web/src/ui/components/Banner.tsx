import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { Button } from "./Button"
import { IconAlert, IconInfo } from "./icons"

export type BannerKind = "neutral" | "warning" | "danger" | "info"

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

/** Inline message bar — `.banner` variants. */
export function Banner({ kind = "neutral", title, children, icon, action, className }: BannerProps) {
  const resolvedIcon = icon !== undefined ? icon : DEFAULT_ICON[kind]
  return (
    <div className={cn("banner", kind !== "neutral" && `banner-${kind}`, className)} role="status">
      {resolvedIcon !== null ? (
        <span className="banner-icon" aria-hidden="true">
          {resolvedIcon}
        </span>
      ) : null}
      <div className="banner-body">
        {title !== undefined ? <div className="banner-title">{title}</div> : null}
        {children !== undefined ? <div className="banner-text">{children}</div> : null}
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
