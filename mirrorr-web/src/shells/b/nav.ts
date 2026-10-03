import type { ComponentType } from "react"
import {
  IconAutoruns,
  IconImportExport,
  IconPlugins,
  IconProfiles,
  IconRecordings,
  IconSessions,
  IconSettings,
} from "@/components/ui/icons"
import type { IconProps } from "@/components/ui/icons"

/**
 * nav — Variant B's spine destinations (§4 contents, matching §3's route set).
 * Paths are literal route paths; the shell never imports `src/routes`, so this
 * is chrome configuration, not routing. `ShellBNavPath` keeps them narrow so
 * `<Link>` stays typed against the registered route tree.
 */
export type ShellBNavPath =
  | "/sessions"
  | "/autoruns"
  | "/recordings"
  | "/profiles"
  | "/plugins"
  | "/import-export"
  | "/settings"

export interface ShellBNavItem {
  readonly path: ShellBNavPath
  readonly label: string
  readonly icon: ComponentType<IconProps>
}

export const NAV_ITEMS: readonly ShellBNavItem[] = [
  { path: "/sessions", label: "Sessions", icon: IconSessions },
  { path: "/autoruns", label: "Autoruns", icon: IconAutoruns },
  { path: "/recordings", label: "Recordings", icon: IconRecordings },
  { path: "/profiles", label: "Profiles", icon: IconProfiles },
  { path: "/plugins", label: "Plugins", icon: IconPlugins },
  { path: "/import-export", label: "Import / Export", icon: IconImportExport },
  { path: "/settings", label: "Settings", icon: IconSettings },
]

const SESSIONS_TITLE = "Sessions"

/**
 * §11.1: `index-route` ("/") renders the Sessions list, so "/" reads as
 * Sessions. Detail routes (`/sessions/$id`, `/settings/users`) keep their
 * section title — the section is what the chrome names, not the record.
 */
export function viewTitleForPath(pathname: string): string {
  if (pathname === "/") return SESSIONS_TITLE
  const match = NAV_ITEMS.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  )
  return match?.label ?? "MIRRORR"
}

export function isNavActive(pathname: string, item: ShellBNavItem): boolean {
  if (pathname === "/") return item.path === "/sessions"
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}
