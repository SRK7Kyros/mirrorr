import { useRouterState } from "@tanstack/react-router"
import { IconButton, IconMenu } from "@/ui/components"
import { describeRoute } from "./breadcrumb"
import { ConnectionPill } from "./connection-pill"
import { NotificationBell } from "./notification-bell"

export function TopBar({ onOpenNav }: { readonly onOpenNav: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const crumb = describeRoute(pathname)

  return (
    <header className="topbar">
      <IconButton
        className="topbar-menu-btn"
        label="Open navigation"
        icon={<IconMenu size={18} />}
        onClick={onOpenNav}
      />
      <div className="crumb">
        {crumb.parent !== null ? (
          <>
            <span className="crumb-parent">{crumb.parent}</span>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        <span className="crumb-current">{crumb.current}</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <ConnectionPill />
        <NotificationBell />
      </div>
    </header>
  )
}
