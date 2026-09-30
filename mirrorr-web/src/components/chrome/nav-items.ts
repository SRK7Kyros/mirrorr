import type { ComponentType } from "react"
import type { IconProps } from "@/components/ui/icons"
import {
  IconAutoruns,
  IconImportExport,
  IconPlugins,
  IconProfiles,
  IconRecordings,
  IconSessions,
  IconSettings,
} from "@/components/ui/icons"

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly to: string
  readonly icon: ComponentType<IconProps>
}

/** §3.1 nav order is normative: Sessions · Autoruns · Recordings · Profiles · Plugins · Import/Export · Settings. */
export const primaryNav: ReadonlyArray<NavItem> = [
  { id: "sessions", label: "Sessions", to: "/sessions", icon: IconSessions },
  { id: "autoruns", label: "Autoruns", to: "/autoruns", icon: IconAutoruns },
  { id: "recordings", label: "Recordings", to: "/recordings", icon: IconRecordings },
  { id: "profiles", label: "Profiles", to: "/profiles", icon: IconProfiles },
  { id: "plugins", label: "Plugins", to: "/plugins", icon: IconPlugins },
  { id: "import-export", label: "Import/Export", to: "/import-export", icon: IconImportExport },
  { id: "settings", label: "Settings", to: "/settings", icon: IconSettings },
]

/** §3.3 compact: 4 destinations + More (sheet holds the rest). */
export const compactTabs: ReadonlyArray<NavItem> = primaryNav.slice(0, 4)

/** §3.3 route → tab map: non-tab destinations activate the More slot. */
export const moreSheetPaths: ReadonlyArray<string> = ["/plugins", "/import-export", "/settings"]

/** §5 V11–V13: settings children carry their own view title (§3.1). */
const sectionTitles: ReadonlyArray<readonly [string, string]> = [
  ["/settings/users", "Users"],
  ["/settings/clients", "API clients"],
]

const titleByPath: ReadonlyMap<string, string> = new Map<string, string>([
  ...primaryNav.map((item) => [item.to, item.label] as const),
  ...sectionTitles,
])

/**
 * Longest-prefix match (§3.1 view title): `/settings/users` → "Users",
 * `/sessions/$id` → "Sessions", unknown paths fall back to the brand.
 */
export function titleForPath(pathname: string): string {
  let bestPath = ""
  let bestTitle = "Mirrorr"
  for (const [path, title] of titleByPath) {
    const matches = pathname === path || pathname.startsWith(`${path}/`)
    if (matches && path.length > bestPath.length) {
      bestPath = path
      bestTitle = title
    }
  }
  return bestTitle
}
