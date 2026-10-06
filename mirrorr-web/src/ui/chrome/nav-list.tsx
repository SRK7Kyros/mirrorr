import { Fragment } from "react"
import { Link, useMatchRoute } from "@tanstack/react-router"
import { NAV_SECTIONS } from "./nav-items"

export function NavList({ onNavigate }: { readonly onNavigate?: () => void }) {
  const matchRoute = useMatchRoute()
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <Fragment key={section.label}>
          <div className="nav-section">{section.label}</div>
          {section.items.map((item) => {
            const active = matchRoute({ to: item.to, fuzzy: item.exact !== true }) !== false
            return (
              <Link
                key={item.to}
                to={item.to}
                className={active ? "nav-item nav-item-active" : "nav-item"}
                onClick={onNavigate}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            )
          })}
        </Fragment>
      ))}
    </>
  )
}
