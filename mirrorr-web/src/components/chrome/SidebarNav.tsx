/**
 * Spec L17-L23 / L489-L491: the fixed sidebar — 224px at ≥900px, collapsing to
 * a 56px icon-only rail at 640-899px (the spec's collapse rule). The seven
 * destinations render in spec order; the active item carries `aria-current`,
 * the overlay background and a 2px accent left bar.
 */
import { Link, useMatchRoute } from "@tanstack/react-router"
import { NAV_ITEMS } from "@/components/chrome/nav-items"

export function SidebarNav() {
  const matchRoute = useMatchRoute()

  return (
    <aside
      data-testid="sidebar"
      className="flex h-full w-14 shrink-0 flex-col border-r border-border bg-bg-raised min-[900px]:w-56"
    >
      <div className="flex h-12 items-center border-b border-border px-2 min-[900px]:px-4">
        <span className="hidden text-title font-semibold text-text-primary min-[900px]:inline">
          Mirrorr
        </span>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = Boolean(matchRoute({ to: item.to, fuzzy: true }))
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              data-active={active ? "true" : undefined}
              className={[
                "relative flex h-9 items-center gap-3 rounded-control px-2 text-body transition-colors",
                active
                  ? "bg-bg-overlay text-text-primary"
                  : "text-text-secondary hover:bg-bg-overlay hover:text-text-primary",
              ].join(" ")}
            >
              <span
                data-testid="nav-active-bar"
                aria-hidden="true"
                className={[
                  "absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-pill",
                  active ? "bg-accent" : "bg-transparent",
                ].join(" ")}
              />
              <item.icon
                aria-hidden="true"
                strokeWidth={2}
                className="mx-auto size-[var(--icon-default)] shrink-0 min-[900px]:mx-0"
              />
              <span className="truncate sr-only min-[900px]:not-sr-only">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
