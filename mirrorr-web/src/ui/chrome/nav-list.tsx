import { Fragment } from "react"
import { Link, useMatchRoute } from "@tanstack/react-router"
import { cn } from "@/ui/lib/cn"
import { NAV_SECTIONS } from "./nav-items"

const NAV_ITEM_CLASS =
  "relative flex items-center gap-3 rounded-sm p-[var(--s-2)_var(--s-3)] text-base font-medium transition-[background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] [&>svg]:shrink-0 max-lg:justify-center max-lg:p-[var(--s-2)] tab-stop"
const NAV_ITEM_ACTIVE =
  "bg-[var(--accent-dim)] text-brand before:absolute before:left-0 before:top-1/2 before:h-[18px] before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-brand before:content-['']"
const NAV_ITEM_IDLE = "text-ink-muted hover:bg-surface-2 hover:text-ink"

export function NavList({ onNavigate }: { readonly onNavigate?: () => void }) {
  const matchRoute = useMatchRoute()
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <Fragment key={section.label}>
          <div className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-dim max-lg:hidden">
            {section.label}
          </div>
          {section.items.map((item) => {
            const active = matchRoute({ to: item.to, fuzzy: item.exact !== true }) !== false
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(NAV_ITEM_CLASS, active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE)}
                onClick={onNavigate}
              >
                {item.icon}
                <span className="max-lg:hidden">{item.label}</span>
              </Link>
            )
          })}
        </Fragment>
      ))}
    </>
  )
}
