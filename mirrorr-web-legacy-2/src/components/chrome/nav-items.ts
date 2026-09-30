import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRight,
  CalendarClock,
  Film,
  Puzzle,
  Radio,
  Settings,
  SlidersHorizontal,
} from "lucide-react"

/**
 * The seven sidebar destinations in spec order (docs/web-frontend-spec.md
 * L17-L23): Sessions, Autoruns, Recordings, Profiles, Plugins, Import/Export,
 * Settings. Order is the contract; the chrome renders this array verbatim.
 */
export interface NavItem {
  readonly label: string
  readonly to: string
  readonly icon: LucideIcon
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Sessions", to: "/sessions", icon: Radio },
  { label: "Autoruns", to: "/autoruns", icon: CalendarClock },
  { label: "Recordings", to: "/recordings", icon: Film },
  { label: "Profiles", to: "/profiles", icon: SlidersHorizontal },
  { label: "Plugins", to: "/plugins", icon: Puzzle },
  { label: "Import/Export", to: "/import-export", icon: ArrowLeftRight },
  { label: "Settings", to: "/settings", icon: Settings },
]
