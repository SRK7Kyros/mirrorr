import { Outlet, useRouterState } from "@tanstack/react-router"
import { useAuthState } from "@/hooks/use-auth-state"
import { useLooseNavigate } from "@/views/shared/parts"

/**
 * V11 settings shell — vertical tab list (Account · Users · API clients;
 * admin only sees all three) over a single content column max 560px.
 * Tabs reuse `.nav-item` §4 geometry: 36px, r4, active = fill-active +
 * 2px accent left bar via `[aria-current="page"]` (chrome.css).
 * String-typed hrefs/navigate: /settings/users and /settings/clients are
 * children of settingsRoute (reported for wiring; router.tsx untouched).
 */

interface SettingsTab {
  readonly id: string
  readonly label: string
  readonly to: string
}

const ADMIN_TABS: ReadonlyArray<SettingsTab> = [
  { id: "account", label: "Account", to: "/settings" },
  { id: "users", label: "Users", to: "/settings/users" },
  { id: "clients", label: "API clients", to: "/settings/clients" },
]

const ACCOUNT_TAB: SettingsTab = ADMIN_TABS[0]!

function isTabActive(pathname: string, to: string): boolean {
  return to === "/settings" ? pathname === "/settings" : pathname.startsWith(to)
}

export function SettingsView() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { auth } = useAuthState()
  const navigate = useLooseNavigate()
  const admin = auth?.user?.role === "admin"
  const tabs = admin ? ADMIN_TABS : [ACCOUNT_TAB]

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Settings</h1>
      </div>
      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={tab.to}
            className="nav-item"
            aria-current={isTabActive(pathname, tab.to) ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate({ to: tab.to })
            }}
          >
            <span className="nav-item__label">{tab.label}</span>
          </a>
        ))}
      </nav>
      <div className="settings-content">
        <Outlet />
      </div>
    </div>
  )
}
