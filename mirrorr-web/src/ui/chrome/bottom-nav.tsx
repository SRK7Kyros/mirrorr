import { Link, useMatchRoute } from "@tanstack/react-router"
import { motion } from "motion/react"
import { IconMenu, menuAnchorClass, menuItemClass, MenuPopover, useMenuDismiss } from "@/ui/components"
import { springs } from "@/ui/lib/motion"
import { MOBILE_OVERFLOW, MOBILE_TABS } from "./nav-items"

export function BottomNav() {
  const matchRoute = useMatchRoute()
  const { open, setOpen, wrapRef } = useMenuDismiss()

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
              {active ? (
                <motion.span layoutId="bottomnav-pill" className="bottomnav-pill" transition={springs.snappy} />
              ) : null}
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
        <div className={menuAnchorClass} ref={wrapRef}>
          <button
            type="button"
            className="bottomnav-item bottomnav-burger"
            aria-label="More navigation"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <IconMenu size={20} />
          </button>
          <MenuPopover open={open} placement="up" onClick={() => setOpen(false)}>
            {MOBILE_OVERFLOW.map((item) => (
              <Link key={item.to} to={item.to} role="menuitem" className={menuItemClass}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </MenuPopover>
        </div>
      </div>
    </nav>
  )
}
