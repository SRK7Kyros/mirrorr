import { Link, useRouterState } from "@tanstack/react-router"
import { AccountMenu } from "./account-menu"
import { describeRoute } from "./breadcrumb"
import { ConnectionPill } from "./connection-pill"
import { NotificationBell } from "./notification-bell"

export function TopBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const crumb = describeRoute(pathname)

  return (
    <header className="sticky top-0 z-[var(--z-topbar)] flex h-[calc(var(--topbar-h)_+_var(--safe-top))] shrink-0 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-5 pt-[var(--safe-top)] backdrop-blur-[12px] max-sm:px-3">
      <div className="flex min-w-0 items-center gap-2 text-md font-semibold">
        {crumb.parent !== null && crumb.parentPath !== null ? (
          <>
            <Link className="tab-stop font-medium text-ink-muted hover:text-ink" to={crumb.parentPath}>
              {crumb.parent}
            </Link>
            <span className="text-ink-faint" aria-hidden="true">
              /
            </span>
            <span className="truncate text-ink">{crumb.current}</span>
          </>
        ) : (
          <Link className="tab-stop truncate text-ink-muted hover:text-ink" to="/sessions">
            Mirrorr
          </Link>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <ConnectionPill />
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  )
}
