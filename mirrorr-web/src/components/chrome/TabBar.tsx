import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { IconMoreH } from "@/components/ui/icons"
import { compactTabs, moreSheetPaths } from "./nav-items"

export interface TabBarProps {
  readonly pathname: string
  readonly onOpenMore: () => void
  readonly moreOpen: boolean
}

const microSpring = { type: "spring", stiffness: 400, damping: 30 } as const

/**
 * TabBar — ≤639 (§3.3): 56px + safe-bottom, exactly 5 slots
 * Sessions · Autoruns · Recordings · Profiles · More; icon 22 stroke 2,
 * label 11/500, active `#7DB1E5` / inactive `#7E8798`, whileTap .97.
 * More (and its sheet routes) open the bottom sheet with the rest.
 */
export function TabBar({ pathname, onOpenMore, moreOpen }: TabBarProps) {
  const moreActive = moreSheetPaths.includes(pathname)

  return (
    <nav className="tabbar" aria-label="Primary compact">
      {compactTabs.map((item) => {
        const Icon = item.icon
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
        return (
          <motion.div key={item.id} whileTap={active ? undefined : { scale: 0.97 }} transition={microSpring} style={{ flex: "1 1 0", display: "flex" }}>
            <Link to={item.to} className="tab" aria-current={active ? "page" : undefined}>
              <Icon size={22} strokeWidth={2} />
              <span className="tab__label">{item.label}</span>
            </Link>
          </motion.div>
        )
      })}
      <motion.div whileTap={{ scale: 0.97 }} transition={microSpring} style={{ flex: "1 1 0", display: "flex" }}>
        <button
          type="button"
          className="tab"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-current={moreActive ? "page" : undefined}
          onClick={onOpenMore}
        >
          <IconMoreH size={22} strokeWidth={2} />
          <span className="tab__label">More</span>
        </button>
      </motion.div>
    </nav>
  )
}
