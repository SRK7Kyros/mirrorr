import { Link } from "@tanstack/react-router"
import type { NavItem } from "./nav-items"

export interface NavRowProps {
  readonly item: NavItem
}

/**
 * Shared sidebar/rail nav row (§3.1/§3.2). `aria-label` keeps the name
 * intact when CSS hides the rail's label; `title` is the rail tooltip.
 * Active state: fill-active + 2px primary inset bar, `aria-current="page"`.
 */
export function NavRow({ item }: NavRowProps) {
  const Icon = item.icon

  return (
    <Link
      to={item.to}
      className="nav-item"
      aria-label={item.label}
      title={item.label}
      activeOptions={{ exact: false }}
    >
      <span className="nav-item__icon">
        <Icon size={16} />
      </span>
      <span className="nav-item__label">{item.label}</span>
    </Link>
  )
}
