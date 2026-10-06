import { useAuthState } from "@/api"
import { IconDisc } from "@/ui/components"
import { describeIdentity } from "./identity"
import { NavList } from "./nav-list"
import { UserCard } from "./user-card"

export function Sidebar() {
  const auth = useAuthState()
  const identity = describeIdentity(auth.auth)
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">
          <IconDisc size={16} />
        </span>
        <div className="brand-text">
          <div className="brand-name">Mirrorr</div>
          <div className="brand-sub">Control Room</div>
        </div>
      </div>
      <nav className="sidebar-nav" aria-label="Primary">
        <NavList />
      </nav>
      <div className="sidebar-foot">
        <UserCard displayName={identity.name} role={identity.role} />
      </div>
    </aside>
  )
}
