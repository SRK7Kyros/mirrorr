import { NavRow } from "./NavRow"
import { primaryNav } from "./nav-items"

/**
 * IconRail — 640–899px (§3.2/§6): 56px icon-only column, same nav items
 * with aria-label + title tooltip, topbar stays 48, main pad drops to 16.
 */
export function IconRail() {
  return (
    <nav aria-label="Primary" className="rail">
      <ul className="rail__list">
        {primaryNav.map((item) => (
          <li key={item.id}>
            <NavRow item={item} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
