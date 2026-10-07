import { useRouterState } from "@tanstack/react-router"
import { AccountMenu } from "./account-menu"
import { describeRoute } from "./breadcrumb"
import { ConnectionPill } from "./connection-pill"
import { NotificationBell } from "./notification-bell"

export function TopBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const crumb = describeRoute(pathname)

  return (
    <header className="topbar">
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
        <AccountMenu />
      </div>
    </header>
  )
}
