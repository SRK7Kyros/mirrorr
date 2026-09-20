/**
 * The compact shell's route derivation, in one place (spec L489-L501).
 *
 * The bottom tab bar's five slots and the route→tab map come from here, as do
 * the FAB flag/omit rules; no view re-derives either. Icons and labels for the
 * four destination slots are read out of `nav-items.ts` (the sidebar's spec
 * order), so the compact tabs cannot drift from the desktop destinations.
 */
import type { LucideIcon } from "lucide-react"
import { MoreHorizontal } from "lucide-react"
import { NAV_ITEMS, type NavItem } from "@/components/chrome/nav-items"

export type CompactTabId = "sessions" | "autoruns" | "recordings" | "profiles" | "more"

export interface CompactTab {
  readonly id: CompactTabId
  readonly label: string
  readonly icon: LucideIcon
  /** Destination path; `null` means the slot opens the More sheet instead. */
  readonly to: string | null
}

function navItemFor(to: string): NavItem {
  const item = NAV_ITEMS.find((entry) => entry.to === to)
  if (item === undefined) {
    throw new Error(`compact nav: nav-items.ts has no destination for ${to}`)
  }
  return item
}

/** Spec L496: five slots, in order — Sessions, Autoruns, Recordings, Profiles, More. */
export const COMPACT_TABS: readonly CompactTab[] = [
  { id: "sessions", ...navItemFor("/sessions") },
  { id: "autoruns", ...navItemFor("/autoruns") },
  { id: "recordings", ...navItemFor("/recordings") },
  { id: "profiles", ...navItemFor("/profiles") },
  { id: "more", label: "More", icon: MoreHorizontal, to: null },
]

/**
 * Spec L501: `/sessions*` → Sessions, `/autoruns*` → Autoruns, `/recordings*`
 * → Recordings, `/profiles*` → Profiles, `/plugins|/import-export|/settings*`
 * → More. A path that matches no prefix (e.g. the dev probe) belongs to no
 * tab, and More is the only slot that can carry it.
 */
const TAB_PREFIXES: readonly (readonly [string, CompactTabId])[] = [
  ["/sessions", "sessions"],
  ["/autoruns", "autoruns"],
  ["/recordings", "recordings"],
  ["/profiles", "profiles"],
  ["/plugins", "more"],
  ["/import-export", "more"],
  ["/settings", "more"],
]

export function compactTabForPath(pathname: string): CompactTabId {
  const match = TAB_PREFIXES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  return match?.[1] ?? "more"
}

/**
 * Spec L498: the app bar shows the back chevron on nested routes and the
 * Mirrorr mark at the top-level destinations. A path is nested when it sits
 * below a top-level destination (e.g. `/sessions/5`, `/settings/users`).
 */
export function isNestedRoute(pathname: string): boolean {
  return pathname.split("/").filter((segment) => segment.length > 0).length > 1
}

export type CompactFabActionId = "new-session" | "new-autorun" | "new-profile" | "new-user" | "new-key"

/**
 * The FAB's flag/omit rule for a pathname. Spec L497: one 56px circular accent
 * FAB, omitted on read-only views (Plugins) and replaced by the in-page control
 * when the view's action is a toggle / lives in the view. Rules match the
 * exact list path, so detail routes (whose actions live in the header) omit.
 */
export type CompactFabRule =
  | { readonly kind: "action"; readonly id: CompactFabActionId; readonly label: string }
  | { readonly kind: "omit"; readonly reason: "read-only" | "in-page" }

const FAB_ACTIONS: Readonly<Record<string, { readonly id: CompactFabActionId; readonly label: string }>> = {
  "/sessions": { id: "new-session", label: "New session" },
  "/autoruns": { id: "new-autorun", label: "New autorun" },
  "/profiles": { id: "new-profile", label: "New profile" },
  "/settings/users": { id: "new-user", label: "New user" },
  "/settings/clients": { id: "new-key", label: "New key" },
}

const READ_ONLY_PATHS: ReadonlySet<string> = new Set(["/plugins"])

export function compactFabForPath(pathname: string): CompactFabRule {
  const action = FAB_ACTIONS[pathname]
  if (action !== undefined) return { kind: "action", ...action }
  if (READ_ONLY_PATHS.has(pathname)) return { kind: "omit", reason: "read-only" }
  return { kind: "omit", reason: "in-page" }
}
