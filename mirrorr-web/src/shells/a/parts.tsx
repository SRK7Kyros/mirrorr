import { motion, useReducedMotion, useScroll, useTransform } from "motion/react"
import { useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { isApiClientPrincipal } from "@/lib/auth"
import { API_CLIENT_POLL_LABEL, useAuthState } from "@/shells/a/chrome-data"
import {
  Badge,
  Button,
  IconAutoruns,
  IconBell,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconHelp,
  IconImportExport,
  IconMoreH,
  IconPlugins,
  IconProfiles,
  IconRecordings,
  IconSessions,
  IconSettings,
  OverflowMenu,
  StatusChip,
  tweenEnter,
} from "@/components/ui"
import type { IconProps } from "@/components/ui/icons"
import type { OverflowMenuItem } from "@/components/ui"

/* ───────────────────────────────────────────────────────────────────────────
 * Shell A chrome parts (§3). Pure presentation — no routes, no data hooks.
 *
 * §2: the backdrop CARRIER is a shell layout decision and lives in
 * ShellA.tsx; `Backdrop` (the scrim + media + licensed mesh content) is
 * rendered ONLY as a child of that carrier, so `.acrylic` falls through to
 * its opaque twin when no media is behind it.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Icon geometry per §1.4/§6: 20px on acrylic, 16px inside opaque chrome. */
const ICON_RAIL = 20
const ICON_CHROME = 16

const NAV_GLYPH = {
  sessions: IconSessions,
  autoruns: IconAutoruns,
  recordings: IconRecordings,
  profiles: IconProfiles,
  plugins: IconPlugins,
  "import-export": IconImportExport,
  settings: IconSettings,
} satisfies Record<string, ComponentType<IconProps>>
type GlyphKey = keyof typeof NAV_GLYPH

export interface NavSurface {
  readonly id: GlyphKey
  readonly label: string
  readonly href: string
}

/**
 * §3 nav model — one destination per surface, in the spec's order. A single
 * table drives the full rail, the collapsed 72px rail and the compact tab
 * bar, so `label` is reused verbatim as the icon-only tooltip (`title`).
 */
export const NAV_SURFACES: ReadonlyArray<NavSurface> = [
  { id: "sessions", label: "Sessions", href: "/sessions" },
  { id: "autoruns", label: "Autoruns", href: "/autoruns" },
  { id: "recordings", label: "Recordings", href: "/recordings" },
  { id: "profiles", label: "Profiles", href: "/profiles" },
  { id: "plugins", label: "Plugins", href: "/plugins" },
  { id: "import-export", label: "Import/Export", href: "/import-export" },
  { id: "settings", label: "Settings", href: "/settings" },
]

/** The same glyphs, keyed by id, for the compact tab bar's `NAV_GLYPH[key]`. */
export { NAV_GLYPH }

/**
 * §3 `<768` compact bar shows the first four surfaces; the fifth item is a
 * `More` trigger for the drawer carrying the remainder — Plugins is a VIEW
 * there, so only Import/Export + Settings and the user block are displaced.
 */
export const COMPACT_SURFACE_IDS = ["sessions", "autoruns", "recordings", "plugins"] as const
export const MORE_SURFACE_IDS = ["profiles", "import-export", "settings"] as const

export function navSurfaceLabel(id: string): string {
  return NAV_SURFACES.find((surface) => surface.id === id)?.label ?? id
}

/* ── view title ─────────────────────────────────────────────────────────── */

const TITLE_MAP: Readonly<Record<string, string>> = {
  "/sessions": "Sessions",
  "/autoruns": "Autoruns",
  "/recordings": "Recordings",
  "/profiles": "Profiles",
  "/plugins": "Plugins",
  "/import-export": "Import/Export",
  "/settings": "Settings",
  "/settings/users": "Users",
  "/settings/clients": "API clients",
}

/** Longest-prefix title, matching `titleForPath` in the chrome model. */
export function titleForPath(pathname: string): string {
  let best = ""
  let bestLength = -1
  for (const [path, title] of Object.entries(TITLE_MAP)) {
    const isMatch = pathname === path || pathname.startsWith(`${path}/`)
    if (isMatch && path.length > bestLength) {
      best = title
      bestLength = path.length
    }
  }
  return best === "" ? "Mirrorr" : best
}

/* ── backdrop (§2) ──────────────────────────────────────────────────────── */

export interface BackdropProps {
  /**
   * §2.2 media precedence: live session still → recording poster frame →
   * empty-database default. Undefined renders the licensed gradient mesh.
   */
  readonly mediaUrl?: string
  /** §2.1 scrim steps 55 → 65/75 under text runs on media. */
  readonly scrim?: "55" | "65" | "75"
}

/**
 * Backdrop — §2.1–§2.3 (scrim + parallax-carried media + licensed mesh).
 * The single parallax carrier translates the media `y: -40px → 40px` of the
 * stage's own scroll (`clamp: false`, §9). `.acrylic` chrome drifts at 0.25×
 * and is not expressed here: `useScroll` can only track the document or a
 * ref'd container, not an arbitrary module-created scroller.
 *
 * Under `prefers-reduced-transparency` the shell hides this whole layer and
 * every `.acrylic` falls through to glass.css's opaque twin (§8.6).
 */
export function Backdrop({ mediaUrl, scrim = "55" }: BackdropProps) {
  const progress = useScroll()
  const y = useTransform(progress.scrollY, [0, 1000], [-40, 40], { clamp: false })

  const mediaStyle = mediaUrl === undefined ? undefined : { backgroundImage: `url("${mediaUrl}")` }

  return (
    <div className="shell-a__backdrop-content">
      <div
        className={scrim === "55" ? "backdrop-scrim" : `backdrop-scrim scrim-${scrim}`}
        aria-hidden="true"
      />
      {mediaUrl !== undefined ? (
        <motion.div className="shell-a__media" style={{ y }} aria-hidden="true">
          <div className="shell-a__media-carrier" style={mediaStyle} />
        </motion.div>
      ) : null}
      {mediaUrl === undefined ? <div className="backdrop-mesh shell-a__mesh" aria-hidden="true" /> : null}
    </div>
  )
}

/* ── wordmark plate ─────────────────────────────────────────────────────── */

/** §3 wordmark plate — `label-caps` on an opaque mini-plate (never on glass). */
export function WordmarkPlate({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className={compact ? "shell-a__wordmark shell-a__wordmark--compact" : "shell-a__wordmark"}>
      <p className="t-label-caps shell-a__wordmark-name">Mirrorr</p>
      <p className="shell-a__wordmark-sub">recorder console</p>
    </div>
  )
}

/* ── connection chip (WS state) ─────────────────────────────────────────── */

export interface ConnectionChipProps {
  readonly label: string
  readonly tone: "live" | "polling" | "offline"
}

/**
 * ConnectionChip — the chip's WORLD carries the hue (success-deep / warning-deep
 * / text-muted), the word stays `#141414` (§1.4: status colour is never text).
 * The trigger stays a bare button: one interactive element, its own `aria-label`,
 * no title so a hover tooltip never adds a second interactive node.
 */
export function ConnectionChip({ label, tone }: ConnectionChipProps) {
  return (
    <button type="button" className={`chip chip--static chip--conn shell-a__conn--${tone}`} aria-label={`Connection: ${label}`}>
      <span className="shell-a__conn-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

/* ── tally band (§3 first row of the stage) ─────────────────────────────── */

export interface TallyPlate {
  readonly id: string
  /**
   * Asymmetric spans — never three equal plates (§3/§11 hard law). A `number`
   * span is emitted only inside `tally-band`'s explicit grid template; the
   * default template also varies, so both paths stay asymmetric.
   */
  readonly span: number
  readonly eyebrow: string
  readonly headline: string
  readonly chips?: ReadonlyArray<{ readonly status: "active" | "recording" | "scheduled"; readonly title: string }>
  readonly stats: ReadonlyArray<{ readonly label: string; readonly value: string }>
  /** The one plate that leaves the acrylic for the media-gap reading surface. */
  readonly bare?: boolean
}

function PlateBody({ plate }: { readonly plate: TallyPlate }) {
  return (
    <>
      <p className="t-label-caps shell-a__plate-eyebrow">{plate.eyebrow}</p>
      <h2 className="shell-a__plate-headline">{plate.headline}</h2>
      {plate.chips !== undefined && plate.chips.length > 0 ? (
        <div className="shell-a__plate-chips">
          {plate.chips.map((chip) => (
            <StatusChip key={chip.title} status={chip.status} title={chip.title} compact />
          ))}
        </div>
      ) : null}
      <dl className="shell-a__plate-stats">
        {plate.stats.map((stat) => (
          <div className="shell-a__stat" key={stat.label}>
            <dt className="shell-a__stat-label">{stat.label}</dt>
            <dd className="shell-a__stat-value num">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function TallyPlateView({ plate }: { readonly plate: TallyPlate }) {
  if (plate.bare === true) {
    return (
      <article className="tally-plate tally-plate--bare" style={{ gridColumn: `span ${plate.span}` }}>
        <div className="tally-plate__surface">
          <PlateBody plate={plate} />
        </div>
      </article>
    )
  }
  return (
    <article className="tally-plate acrylic acrylic--card" style={{ gridColumn: `span ${plate.span}` }}>
      <PlateBody plate={plate} />
    </article>
  )
}

/**
 * TallyBand — the stage's first row, over a media gap, at z10. Plates are
 * asymmetric acrylic 0.64/16 instrument surfaces (≥14px content only, never
 * inside a panel). When the backdrop is off the band is removed entirely —
 * chrome-after-chrome is the rejected dark-console look.
 */
export function TallyBand({ plates }: { readonly plates: ReadonlyArray<TallyPlate> }) {
  return (
    <section className="tally-band" aria-label="At a glance">
      {plates.map((plate) => (
        <TallyPlateView key={plate.id} plate={plate} />
      ))}
    </section>
  )
}

/* ── rail footer: connection + API-client note + user menu ──────────────── */

const SIGN_OUT_ITEM: OverflowMenuItem = {
  id: "sign-out",
  label: "Sign out",
  destructive: true,
  onSelect: () => {},
}

/**
 * UserMenu — the rail/topbar user chip: `display_name` + role badge, with
 * Account / Change password / Sign out behind the `OverflowMenu` (keyboard
 * model comes from the primitive). Selecting any item is a no-op until the
 * orchestrator wires navigation; the footer states that.
 */
export function UserMenu({ align = "start" }: { readonly align?: "start" | "end" }) {
  const auth = useAuthState()
  const isApiClient = isApiClientPrincipal(auth.auth)
  const displayName = auth.auth?.user?.display_name ?? (isApiClient ? "API client" : "Signed out")
  const role = auth.auth?.user?.role ?? (isApiClient ? "client" : "guest")

  const items: ReadonlyArray<OverflowMenuItem> = [
    { id: "account", label: "Account", onSelect: () => {} },
    { id: "change-password", label: "Change password", onSelect: () => {} },
    SIGN_OUT_ITEM,
  ]

  return (
    <div className="shell-a__user">
      <div className="shell-a__user-chip">
        <span className="shell-a__user-name">{displayName}</span>
        <Badge variant={role === "admin" ? "role-admin" : "role-user"}>{role}</Badge>
      </div>
      <OverflowMenu items={items} triggerLabel="User menu" align={align} />
    </div>
  )
}

/**
 * RailFooter — WS chip, the API-client polling note (label-caps is licensed on
 * opaque chrome only, so this acrylic chip legitimately uses the subdued
 * 12px uppercase treatment `.api-note`) and the user chip.
 */
export function RailFooter({
  connectionLabel,
  connectionTone,
}: {
  readonly connectionLabel: string
  readonly connectionTone: ConnectionChipProps["tone"]
}) {
  const auth = useAuthState()
  const isApiClient = isApiClientPrincipal(auth.auth)

  return (
    <div className="shell-a__rail-footer">
      <ConnectionChip label={connectionLabel} tone={connectionTone} />
      {isApiClient ? <p className="api-note shell-a__api-note">{API_CLIENT_POLL_LABEL}</p> : null}
      <UserMenu />
    </div>
  )
}

/* ── notifications ──────────────────────────────────────────────────────── */

const NOTIFY_ITEMS: ReadonlyArray<OverflowMenuItem> = [
  { id: "notifications-empty", label: "Nothing here yet.", onSelect: () => {}, disabled: true, disabledReason: "Notification feed wiring is pending" },
  SIGN_OUT_ITEM,
]

/**
 * Notifications — bell + unread badge. The badge counts real notification rows
 * when a feed is supplied; otherwise it renders nothing (Badge hides 0, never
 * "0"). The overflow menu is the interim topbar home for the account actions
 * the topbar must expose; the wider panel opens at the modal tier, which is
 * allowed to sit above the nav rail.
 */
export function Notifications({ unread = 0 }: { readonly unread?: number }) {
  return (
    <div className="shell-a__notify">
      <motion.button
        type="button"
        className="shell-a__icon-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        data-empty={unread === 0}
      >
        <IconBell size={ICON_CHROME} />
        <Badge variant="unread" className="shell-a__notify-badge">
          {unread}
        </Badge>
      </motion.button>
    </div>
  )
}

export { NOTIFY_ITEMS }

/* ── account overflow for the topbar ────────────────────────────────────── */

export function TopbarAccount() {
  const auth = useAuthState()
  const isApiClient = isApiClientPrincipal(auth.auth)
  const role = auth.auth?.user?.role ?? (isApiClient ? "client" : "guest")
  const items: ReadonlyArray<OverflowMenuItem> = [
    { id: "account", label: "Account", onSelect: () => {} },
    { id: "change-password", label: "Change password", onSelect: () => {} },
    SIGN_OUT_ITEM,
  ]

  return (
    <div className="shell-a__account">
      <Badge variant={role === "admin" ? "role-admin" : "role-user"}>{role}</Badge>
      <OverflowMenu items={items} triggerLabel="User menu" align="end" />
    </div>
  )
}

/* ── compact tab bar (<768, §7) ─────────────────────────────────────────── */

const MORE_ITEMS: ReadonlyArray<OverflowMenuItem> = [
  { id: "more-profile", label: "Profiles", onSelect: () => {} },
  { id: "more-import-export", label: "Import/Export", onSelect: () => {} },
  { id: "more-settings", label: "Settings", onSelect: () => {} },
]

/**
 * TabBar — the §7 `<768` bottom glass bar: acrylic 0.55/40, radius 8, 16px
 * inset, five ≥44px items. The fifth is `More`, which is a real button (the
 * overflow menu is a topbar affordance) so it can open the drawer the compact
 * shell needs for the displaced surfaces.
 */
export function TabBar({
  activeId,
  onNavigate,
  onMore,
}: {
  readonly activeId: string
  readonly onNavigate: (href: string) => void
  readonly onMore: () => void
}) {
  const reduced = useReducedMotion()

  return (
    <nav className="tabbar acrylic acrylic--nav shell-a__tabbar" aria-label="Primary">
      {COMPACT_SURFACE_IDS.map((id) => {
        const surface = NAV_SURFACES.find((entry) => entry.id === id)
        if (surface === undefined) return null
        const Glyph = NAV_GLYPH[surface.id]
        const isActive = activeId === surface.id
        return (
          <motion.button
            key={surface.id}
            type="button"
            className={isActive ? "tabbar__item tabbar__item--active" : "tabbar__item"}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onNavigate(surface.href)}
            whileTap={reduced === true ? undefined : { scale: 0.96 }}
            transition={tweenEnter}
          >
            <Glyph size={ICON_RAIL} />
            <span className="tabbar__label">{surface.label}</span>
          </motion.button>
        )
      })}
      <motion.button
        type="button"
        className="tabbar__item"
        aria-haspopup="dialog"
        onClick={onMore}
        whileTap={reduced === true ? undefined : { scale: 0.96 }}
        transition={tweenEnter}
      >
        <IconMoreH size={ICON_RAIL} />
        <span className="tabbar__label">More</span>
      </motion.button>
    </nav>
  )
}

export { MORE_ITEMS }

/* ── backdrop state note ────────────────────────────────────────────────── */

export interface BackdropNoteProps {
  readonly enabled: boolean
  readonly onToggle: () => void
}

/**
 * BackdropNote — §2: with the backdrop off the shell carries a loud
 * `label-caps` statement, because every acrylic surface is now flat white and
 * that must never read as an accident (glass on flat white is a BUG).
 * The action restores the backdrop (and reveals itself on hover/focus so the
 * note is not a permanent UI wart); ShellA also renders a standalone restore
 * control, so the note is never the only way back.
 */
export function BackdropNote({ enabled, onToggle }: BackdropNoteProps) {
  const [expanded, setExpanded] = useState(false)

  if (enabled) return null

  return (
    <div
      className="shell-a__note"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      <p className="t-label-caps shell-a__note-text">backdrop off — opaque surfaces</p>
      <button
        type="button"
        className="shell-a__note-action"
        data-expanded={expanded}
        onClick={onToggle}
        aria-label="Restore backdrop"
        title="Restore backdrop"
      >
        <IconHelp size={14} />
      </button>
    </div>
  )
}

/* ── backdrop switch (topbar) ───────────────────────────────────────────── */

export interface BackdropSwitchProps {
  readonly enabled: boolean
  readonly onToggle: () => void
}

/**
 * BackdropSwitch — §2: the explicit control that turns the backdrop (and with
 * it every acrylic surface) on and off. It is chrome, so it lives in the
 * topbar next to the other view-level controls; it is keyboard operable and
 * its pressed state is exposed to assistive tech.
 */
export function BackdropSwitch({ enabled, onToggle }: BackdropSwitchProps) {
  return (
    <button
      type="button"
      className="shell-a__switch"
      aria-pressed={enabled}
      aria-label={enabled ? "Turn backdrop off" : "Turn backdrop on"}
      title={enabled ? "Backdrop on" : "Backdrop off"}
      onClick={onToggle}
    >
      <span className="shell-a__switch-track" aria-hidden="true">
        <span className="shell-a__switch-thumb" />
      </span>
      <span className="shell-a__switch-label">Backdrop</span>
    </button>
  )
}

/* ── breadcrumb ─────────────────────────────────────────────────────────── */

/** §3 topbar breadcrumb: label-caps wordmark + chevron + the view title. */
export function Breadcrumb({ title }: { readonly title: string }) {
  return (
    <nav className="shell-a__crumbs" aria-label="Breadcrumb">
      <span className="t-label-caps shell-a__crumb-root">Mirrorr</span>
      <span className="shell-a__crumb-glyph" aria-hidden="true">
        <IconChevronLeft size={12} />
      </span>
      <span className="t-label-caps shell-a__crumb-view">{title}</span>
    </nav>
  )
}

/* ── stage prose placeholder ────────────────────────────────────────────── */

/**
 * StagePlaceholder — what the stage renders when a route is mounted without a
 * view: the §3 stage is a raw-media reading column, so its bare state states
 * that plainly instead of painting an opaque slab. Views with data supply
 * their own `.panel`s (opaque) inside this scroller.
 */
export function StagePlaceholder({ title }: { readonly title: string }) {
  return (
    <div className="shell-a__pending" role="status">
      <p className="shell-a__pending-eyebrow">Placeholder view</p>
      <h2 className="shell-a__pending-headline">{title}</h2>
      <p className="shell-a__pending-body">
        The shell is mounted. This surface&rsquo;s view is resolved by the router.
      </p>
    </div>
  )
}

/** Long-form copy helper that keeps the shell's own text on the 68ch measure. */
export function ShellMeasure({ children }: { readonly children: ReactNode }) {
  return <p className="shell-a__measure">{children}</p>
}

export { IconClock, IconChevronDown, IconChevronLeft, IconMoreH, IconBell, Button, StatusChip, Badge }
