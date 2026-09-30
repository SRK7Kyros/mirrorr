import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/Badge"
import { IconBell, IconChevronDown } from "@/components/ui/icons"

export type ConnectionState = "connected" | "reconnecting" | "offline"

export interface TopBarProps {
  readonly title: string
  readonly connection: {
    readonly state: ConnectionState
    readonly label: string
    readonly hideDot?: boolean
  }
  readonly notificationCount: number
  readonly onOpenNotifications: () => void
  readonly userLabel: string
  readonly onSignOut?: () => void
  readonly onChangePassword?: () => void
  readonly hideNotifications?: boolean
}

/**
 * TopBar — §3.1: 48px, title left (16/600), right cluster gap 8 =
 * connection dot + label (role=status, never colour-alone), bell
 * (aria-haspopup=dialog + unread Badge), account menu (200px, r8,
 * shadow-menu — overlay layer).
 */
export function TopBar({
  title,
  connection,
  notificationCount,
  onOpenNotifications,
  userLabel,
  onSignOut,
  onChangePassword,
  hideNotifications = false,
}: TopBarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (userRef.current?.contains(event.target as Node) !== true) {
        setUserMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [userMenuOpen])

  return (
    <header className="topbar">
      <span className="topbar__title">{title}</span>
      <div className="topbar__cluster">
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
            <IconBell size={16} />
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
        <div className="user-menu" ref={userRef}>
          <button
            type="button"
            className="user-menu__trigger"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            {userLabel}
            <IconChevronDown size={14} />
          </button>
          {userMenuOpen ? (
            <div
              className="user-menu__panel"
              role="menu"
              aria-label="Account"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setUserMenuOpen(false)
                }
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="overflow__item"
                onClick={() => {
                  setUserMenuOpen(false)
                  onChangePassword?.()
                }}
              >
                Change password
              </button>
              <button
                type="button"
                role="menuitem"
                className="overflow__item overflow__item--destructive"
                onClick={() => {
                  setUserMenuOpen(false)
                  onSignOut?.()
                }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
