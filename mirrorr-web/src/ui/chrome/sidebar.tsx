import { IconDisc } from "@/ui/components"
import { NavList } from "./nav-list"

export function Sidebar() {
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
    </aside>
  )
}
