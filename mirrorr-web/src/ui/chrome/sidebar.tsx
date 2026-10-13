import { IconDisc } from "@/ui/components"
import { NavList } from "./nav-list"

export function Sidebar() {
  return (
    <aside className="sticky top-0 z-[var(--z-sidebar)] flex h-dvh flex-col border-r border-line bg-surface-1 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] max-sm:hidden">
      <div className="flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-line-subtle px-4 max-lg:justify-center max-lg:p-0">
        <span className="grid place-content-center w-7 h-7 rounded-sm text-brand-ink shrink-0 [background:linear-gradient(140deg,var(--accent)_0%,var(--accent-press)_100%)]">
          <IconDisc size={16} />
        </span>
        <div className="max-lg:hidden">
          <div className="text-md font-bold tracking-[-0.02em]">Mirrorr</div>
          <div className="text-2xs text-ink-dim uppercase tracking-[0.08em] [font-family:var(--font-mono)]">Control Room</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3" aria-label="Primary">
        <NavList />
      </nav>
    </aside>
  )
}
