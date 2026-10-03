import { useState } from "react"
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { Tab, TabList, TabPanel } from "@/components/ui/Tab"
import { isAdmin } from "@/lib/auth"
import "@/styles/views-admin.css"

type SettingsTab = "account" | "users" | "clients"

const TAB_LABELS: Record<SettingsTab, string> = {
  account: "Account",
  users: "Users",
  clients: "Clients",
}

function tabFromPath(pathname: string): SettingsTab {
  if (pathname.endsWith("/users")) return "users"
  if (pathname.endsWith("/clients")) return "clients"
  return "account"
}

/**
 * §5.11 Settings shell. Tabs are `label-caps` on opaque chrome; non-admins see
 * Account only (the server 403s the admin routes, so the client hides them —
 * §5.11/§13.7). Each section is a route child rendered through the outlet.
 */
export function SettingsView() {
  const navigate = useNavigate()
  const location = useLocation()
  const admin = isAdmin()
  const [tab, setTab] = useState<SettingsTab>(() => tabFromPath(location.pathname))

  const visible: SettingsTab[] = admin ? ["account", "users", "clients"] : ["account"]

  const select = (next: SettingsTab): void => {
    if (next === tab) return
    setTab(next)
    void navigate({ to: next === "account" ? "/settings" : `/settings/${next}` })
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1 className="t-h2">Settings</h1>
      </header>
      <TabList label="Settings sections" className="settings-tabs chrome-dark">
        {visible.map((entry) => (
          <Tab
            key={entry}
            label={TAB_LABELS[entry]}
            active={tab === entry}
            onSelect={() => select(entry)}
          />
        ))}
      </TabList>
      <TabPanel hidden={false}>
        <Outlet />
      </TabPanel>
    </div>
  )
}
