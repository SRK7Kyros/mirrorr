import { Link, useMatchRoute } from "@tanstack/react-router"
import { MOBILE_TABS } from "./nav-items"

export function BottomNav() {
  const matchRoute = useMatchRoute()
  return (
    <nav className="bottomnav" aria-label="Primary">
      <div className="bottomnav-inner">
        {MOBILE_TABS.map((item) => {
          const active = matchRoute({ to: item.to, fuzzy: item.exact !== true }) !== false
          return (
            <Link
              key={item.to}
              to={item.to}
              className={active ? "bottomnav-item bottomnav-item-active" : "bottomnav-item"}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
