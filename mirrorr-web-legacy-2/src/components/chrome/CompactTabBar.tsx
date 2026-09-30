/**
 * The compact bottom tab bar (spec L496): fixed 56px, `bg-raised`, 1px top
 * border, `<nav aria-label="Primary">` with five slots in spec order —
 * Sessions, Autoruns, Recordings, Profiles, More (sheet). The active slot is
 * accent-toned with a 22px icon, 11px/500 label and `aria-current="page"`;
 * inactive slots are `--text-muted`. Deep links highlight the owning slot.
 */
import { Link, useLocation } from "@tanstack/react-router"
import { useState } from "react"
import { CompactMoreSheet } from "@/components/chrome/CompactMoreSheet"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { COMPACT_TABS, compactTabForPath } from "@/lib/compact-nav"

const SLOT_CLASS = "flex h-14 flex-1 flex-col items-center justify-center gap-1"

export function CompactTabBar() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const active = compactTabForPath(location.pathname)

  return (
    <>
      <nav
        aria-label="Primary"
        data-testid="compact-tab-bar"
        className="compact-tab-bar flex shrink-0 border-t border-border bg-bg-raised"
      >
        {COMPACT_TABS.map((tab) => {
          const current = tab.id === active ? "page" : undefined
          const tone = tab.id === active ? "text-accent" : "text-text-muted"
          const slotClass = [SLOT_CLASS, tone, FOCUS_RING].join(" ")

          if (tab.to === null) {
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`compact-tab-${tab.id}`}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                aria-current={current}
                onClick={() => setMoreOpen(true)}
                className={slotClass}
              >
                <tab.icon aria-hidden="true" strokeWidth={2} className="size-[22px]" />
                <span className="text-micro font-medium">{tab.label}</span>
              </button>
            )
          }

          return (
            <Link
              key={tab.id}
              to={tab.to}
              data-testid={`compact-tab-${tab.id}`}
              aria-current={current}
              className={slotClass}
            >
              <tab.icon aria-hidden="true" strokeWidth={2} className="size-[22px]" />
              <span className="text-micro font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </nav>
      <CompactMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
