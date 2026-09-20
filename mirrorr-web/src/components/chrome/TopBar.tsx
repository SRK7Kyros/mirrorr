/**
 * Spec L17-L23: the 48px top bar holds the current view title on the left and
 * the connection dot, notification bell and user menu on the right. The title
 * is deliberately NOT a heading — each view owns its `<h1>` and the top bar
 * must not duplicate it for assistive tech.
 */
import { useLocation } from "@tanstack/react-router"
import { RealtimeIndicator } from "@/components/chrome/ConnectionDot"
import { NotificationBell } from "@/components/chrome/NotificationBell"
import { UserMenu } from "@/components/chrome/UserMenu"

const VIEW_TITLES: readonly (readonly [string, string])[] = [
  ["/sessions", "Sessions"],
  ["/autoruns", "Autoruns"],
  ["/recordings", "Recordings"],
  ["/profiles", "Profiles"],
  ["/plugins", "Plugins"],
  ["/import-export", "Import/Export"],
  ["/settings", "Settings"],
]

export function viewTitleForPath(pathname: string): string {
  const match = VIEW_TITLES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  return match?.[1] ?? "Mirrorr"
}

export function TopBar() {
  const location = useLocation()

  return (
    <header
      data-testid="top-bar"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-raised px-4"
    >
      <div data-testid="view-title" className="truncate text-title font-semibold text-text-primary">
        {viewTitleForPath(location.pathname)}
      </div>
      <div className="flex items-center gap-2">
        <RealtimeIndicator />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
