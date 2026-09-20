/**
 * The compact app bar (spec L498): 44px, `bg-raised`, 1px bottom border. Left
 * is the 44px back chevron on nested routes and the Mirrorr mark at the tab
 * roots; then the contextual 16px/600 title, ellipsized; then the WS dot and
 * the notification bell, each sitting in a 44px target.
 *
 * The chevron delegates to the platform back seam (spec L498) rather than
 * calling history directly, so a sheet that is somehow above it still consumes
 * the back and todo 29's native bridge behaves identically.
 */
import { useLocation } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { RealtimeIndicator } from "@/components/chrome/ConnectionDot"
import { NotificationBell } from "@/components/chrome/NotificationBell"
import { viewTitleForPath } from "@/components/chrome/TopBar"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { handlePlatformBack } from "@/lib/back-navigation"
import { isNestedRoute } from "@/lib/compact-nav"

const TARGET_CLASS = "flex h-11 w-11 shrink-0 items-center justify-center rounded-control"

export function CompactAppBar() {
  const location = useLocation()
  const nested = isNestedRoute(location.pathname)

  return (
    <header
      data-testid="compact-app-bar"
      className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-bg-raised pr-1 pl-2"
    >
      {nested ? (
        <button
          type="button"
          data-testid="compact-back"
          aria-label="Go back"
          title="Go back"
          onClick={() => {
            handlePlatformBack()
          }}
          className={[
            TARGET_CLASS,
            "text-text-secondary hover:bg-bg-overlay hover:text-text-primary",
            FOCUS_RING,
          ].join(" ")}
        >
          <ChevronLeft aria-hidden="true" strokeWidth={2} className="size-[22px]" />
        </button>
      ) : (
        <span
          data-testid="compact-mark"
          className="flex h-11 shrink-0 items-center pr-1 text-title font-semibold text-text-primary"
        >
          Mirrorr
        </span>
      )}
      <div
        data-testid="view-title"
        className="min-w-0 flex-1 truncate text-title font-semibold text-text-primary"
      >
        {viewTitleForPath(location.pathname)}
      </div>
      <div data-testid="compact-connection" className={[TARGET_CLASS, "min-w-11 px-1"].join(" ")}>
        <RealtimeIndicator />
      </div>
      {/* The bell's own button carries the 44px target under the compact shell. */}
      <div data-testid="compact-bell" className={[TARGET_CLASS, "[&_button]:size-11"].join(" ")}>
        <NotificationBell />
      </div>
    </header>
  )
}
