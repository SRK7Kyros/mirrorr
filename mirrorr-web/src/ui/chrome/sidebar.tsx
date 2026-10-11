import { IconDisc } from "@/ui/components"
import { NavList } from "./nav-list"

export function Sidebar() {
  return (
    <aside className="sticky top-0 z-[var(--z-sidebar)] flex h-dvh flex-col border-r border-line bg-surface-1 max-sm:hidden">
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-line-subtle px-4 max-lg:justify-center max-lg:p-0">
        <span className="brand-mark">
          <IconDisc size={16} />
        </span>
        <div className="max-lg:hidden">
          <div className="brand-name">Mirrorr</div>
          <div className="brand-sub">Control Room</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        <NavList />
      </nav>
    </aside>
  )
}
