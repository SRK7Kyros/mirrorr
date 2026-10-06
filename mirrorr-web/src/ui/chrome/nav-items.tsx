import type { ReactElement } from "react"
import {
  IconAutoruns,
  IconImportExport,
  IconPlugins,
  IconProfiles,
  IconRecordings,
  IconSessions,
  IconSettings,
} from "@/ui/components"

/** The static destination set — a subset of the route tree's app children. */
export type NavPath =
  | "/sessions"
  | "/autoruns"
  | "/recordings"
  | "/profiles"
  | "/plugins"
  | "/import-export"
  | "/settings"

export interface NavItem {
  readonly to: NavPath
  readonly label: string
  readonly icon: ReactElement
  /** Match the path exactly (list roots) rather than as a prefix. */
  readonly exact?: boolean
}

export interface NavSection {
  readonly label: string
  readonly items: readonly NavItem[]
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Record",
    items: [
      { to: "/sessions", label: "Sessions", icon: <IconSessions size={18} />, exact: true },
      { to: "/autoruns", label: "Autoruns", icon: <IconAutoruns size={18} />, exact: true },
      { to: "/recordings", label: "Recordings", icon: <IconRecordings size={18} /> },
    ],
  },
  {
    label: "Configure",
    items: [
      { to: "/profiles", label: "Profiles", icon: <IconProfiles size={18} /> },
      { to: "/plugins", label: "Plugins", icon: <IconPlugins size={18} /> },
      { to: "/import-export", label: "Import / Export", icon: <IconImportExport size={18} /> },
      { to: "/settings", label: "Settings", icon: <IconSettings size={18} /> },
    ],
  },
]

/** Bottom bar destinations — the four most-used surfaces on a phone. */
export const MOBILE_TABS: readonly NavItem[] = [
  { to: "/sessions", label: "Sessions", icon: <IconSessions size={20} />, exact: true },
  { to: "/autoruns", label: "Autoruns", icon: <IconAutoruns size={20} />, exact: true },
  { to: "/recordings", label: "Recordings", icon: <IconRecordings size={20} /> },
  { to: "/profiles", label: "Profiles", icon: <IconProfiles size={20} /> },
]
