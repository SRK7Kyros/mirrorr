import { Badge } from "@/components/ui/Badge"
import { IconBell, IconChevronLeft } from "@/components/ui/icons"

export interface CompactAppBarProps {
  readonly title: string
  readonly connection: {
    readonly state: "connected" | "reconnecting" | "offline"
    readonly label: string
    readonly hideDot?: boolean
  }
  readonly notificationCount: number
  readonly onOpenNotifications: () => void
  /** Renders the 44px back chevron instead of the Mirrorr mark when set (§3.3). */
  readonly onBack?: () => void
  readonly showMark?: boolean
  readonly hideNotifications?: boolean
}

/**
 * CompactAppBar — ≤639 (§3.3/§6): 44px + env(safe-area-inset-top),
 * border-strong bottom, back chevron OR Mirrorr mark left, title
 * centred, conn + bell right (44px touch targets, 16/600 titles).
 */
export function CompactAppBar({
  title,
  connection,
  notificationCount,
  onOpenNotifications,
  onBack,
  showMark = true,
  hideNotifications = false,
}: CompactAppBarProps) {
  return (
    <header className="appbar">
      <div className="appbar__side">
        {onBack !== undefined ? (
          <button type="button" className="appbar__back" aria-label="Back" onClick={onBack}>
            <IconChevronLeft size={20} />
          </button>
        ) : showMark ? (
          <span className="appbar__mark">Mirrorr</span>
        ) : null}
      </div>
      <span className="appbar__title">{title}</span>
      <div className="appbar__side">
        <span className="conn" data-state={connection.state} role="status">
          {connection.hideDot === true ? null : <span className="conn__dot" aria-hidden="true" />}
          <span className="conn__label">{connection.label}</span>
        </span>
        {hideNotifications ? null : (
          <button
            type="button"
            className="bell"
            aria-haspopup="dialog"
            aria-label={
              notificationCount > 0
                ? `Notifications, ${notificationCount} unread`
                : "Notifications"
            }
            onClick={onOpenNotifications}
          >
            <IconBell size={18} />
            {notificationCount > 0 ? (
              <Badge
                variant="unread"
                className="bell__badge"
                aria-label={`${notificationCount} unread notifications`}
              >
                {notificationCount}
              </Badge>
            ) : null}
          </button>
        )}
      </div>
    </header>
  )
}
