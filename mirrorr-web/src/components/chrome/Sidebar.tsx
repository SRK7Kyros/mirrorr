import { NavRow } from "./NavRow"
import { primaryNav } from "./nav-items"

/**
 * Sidebar — desktop ≥900 (§3.1): 224px, spans both grid rows, 48px brand
 * well with “Mirrorr” 16/600, secondary nav scroller (named overflow),
 * 36px items gap 2, active = fill-active + 2px `#0C5CAB` inset-inline bar.
 */
export function Sidebar() {
  return (
    <nav aria-label="Primary" className="sidebar">
      <div className="sidebar__brand">Mirrorr</div>
      <ul className="sidebar__nav">
        {primaryNav.map((item) => (
          <li key={item.id}>
            <NavRow item={item} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
