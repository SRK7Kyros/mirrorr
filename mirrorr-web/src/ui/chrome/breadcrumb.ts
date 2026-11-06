/**
 * Breadcrumb derivation — the shell reads the location pathname and maps it to
 * a section label plus an optional parent for detail routes. No view supplies
 * its own title to the top bar, so the chrome can never drift from the route.
 */

export interface Crumb {
  /** Section label when the route is a detail page, else null. */
  readonly parent: string | null
  /** Route the parent label navigates to — a breadcrumb parent is a real link. */
  readonly parentPath: string | null
  readonly current: string
}

const SECTION_LABELS: Record<string, string> = {
  sessions: "Sessions",
  autoruns: "Autoruns",
  recordings: "Recordings",
  profiles: "Profiles",
  plugins: "Plugins",
  "import-export": "Import / Export",
  settings: "Settings",
}

export function describeRoute(pathname: string): Crumb {
  const segments = pathname.split("/").filter((segment) => segment !== "")
  const section = segments[0]
  if (section === undefined) return { parent: null, parentPath: null, current: "Mirrorr" }
  const label = SECTION_LABELS[section] ?? section
  if (segments.length > 1) {
    return { parent: label, parentPath: `/${section}`, current: `#${segments[1]}` }
  }
  return { parent: null, parentPath: null, current: label }
}
