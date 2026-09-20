/**
 * Settings tab strip (spec L20-L21, L46-L48). Admin users additionally see the
 * Users and API clients tabs; the route guards, not the tabs, enforce access.
 */
import { getAuthState } from "@/lib/auth-store"

export type SettingsTabId = "account" | "users" | "clients"

interface SettingsTab {
  readonly id: SettingsTabId
  readonly href: string
  readonly label: string
  readonly adminOnly: boolean
}

const TABS: readonly SettingsTab[] = [
  { id: "account", href: "/settings", label: "Account", adminOnly: false },
  { id: "users", href: "/settings/users", label: "Users", adminOnly: true },
  { id: "clients", href: "/settings/clients", label: "API clients", adminOnly: true },
]

const TAB_CLASS =
  "inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-0"

export function SettingsTabs({ active }: { readonly active: SettingsTabId }) {
  const isAdmin = getAuthState().user?.role === "admin"
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)

  return (
    <nav data-testid="settings-tabs" aria-label="Settings sections" className="flex border-b border-border">
      {visibleTabs.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={`${TAB_CLASS} ${
            tab.id === active
              ? "border-accent text-text-primary"
              : "border-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
