import { Link, useRouterState } from "@tanstack/react-router"
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react"
import { useRef } from "react"
import type * as React from "react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { IconBell, IconProfiles } from "@/components/ui/icons"
import { MotionRoot } from "@/components/ui/MotionRoot"
import { ToastProvider } from "@/components/ui/Toast"
import { NAV_ITEMS, isNavActive, viewTitleForPath } from "./nav"
import type { ShellBNavItem } from "./nav"
import { useShellBChrome } from "./slots"
import type { ShellBConnection, ShellBWallTile } from "./slots"

/**
 * ShellB — Variant B "Experimental": the monitor-wall deck (§4).
 *
 * Bolder than a rail-and-topbar layout by inverting A's assumption that the
 * product's media is ambient: the `monitor-wall` is a permanent *content*
 * region, chrome shrinks to a dark 64px spine plus one floating acrylic
 * command capsule, and every reading surface is the opaque `work-log` slab.
 *
 * Scroll law (§4) — exactly one owner per region:
 *   work-log ....... THE vertical scroll owner of the view (children render here)
 *   monitor-wall ... owns its own scroll (vertical mosaic ≥1280px, reel below)
 *   spine / capsule / instruments / backdrop .... fixed, never scroll
 * No `100vh`/`100dvh` anywhere: the deck is an absolutely positioned box inside
 * a fixed shell, so the document itself never scrolls.
 *
 * Glass (§2): acrylic only over visible media or the licensed mesh — the
 * capsule (0.55/40) floats over the backdrop, the instrument plates (0.64/16)
 * sit on bare mesh, the wall chips (0.55/8) sit over live stills. The spine is
 * deliberately opaque `secondary` — the deck's frame, not a pane. Reading text
 * never touches acrylic: the work log is opaque, and views' acrylic surfaces
 * inside it downgrade to their opaque twin via the `.acrylic` context rule.
 */

/** §4/§2.3 empty-database default: mesh tiles, one hero + two small. */
const EMPTY_WALL_TILES: readonly ShellBWallTile[] = [
  { id: "wall-empty-hero", hero: true },
  { id: "wall-empty-a" },
  { id: "wall-empty-b" },
]

/** §4: the empty-DB tile caption, verbatim. */
const NO_LIVE_SOURCES = "no live sources"

const CONNECTION_LABEL: Record<ShellBConnection | "unknown", string> = {
  live: "Live updates connected",
  polling: "Live updates offline — polling",
  offline: "Live updates offline",
  unknown: "Live updates status unavailable",
}

/**
 * §9 job 7: the nav active-indicator slide uses the `ui` token and a shared
 * `layoutId`. The bar is rendered for every item by the primitive, so the
 * inactive state hides it here (scoped — never a global override).
 */
function SpineNavItem({ item, active }: { readonly item: ShellBNavItem; readonly active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      to={item.path}
      className={active ? "nav-item nav-item--active shell-b__spine-item" : "nav-item shell-b__spine-item"}
      title={item.label}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-item__indicator" aria-hidden="true" />
      <span className="nav-item__icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <span className="nav-item__label">{item.label}</span>
    </Link>
  )
}

/** §4 wall tile: poster-or-mesh ground + a chip over live stills. */
function WallTile({ tile }: { readonly tile: ShellBWallTile }) {
  const caption = tile.label ?? (tile.hero === true ? NO_LIVE_SOURCES : null)
  return (
    <figure className="shell-b__tile" data-hero={tile.hero === true ? "true" : undefined}>
      {tile.posterUrl !== undefined ? (
        // Cost bound: a still frame at `loading="lazy"`/`decoding="async"` in a
        // fixed-size box — never a <video>, never autoplay, never HLS. No
        // full-quality decode is requested during QA.
        <img className="shell-b__tile-media" src={tile.posterUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="shell-b__tile-media backdrop-mesh" aria-hidden="true" />
      )}
      {caption !== null ? (
        <figcaption className="shell-b__tile-caption">
          {tile.posterUrl !== undefined ? (
            // §2: acrylic 0.55/8 chip over live media (short label-level content).
            <Chip>{caption}</Chip>
          ) : (
            // §4: `label-caps` on a scrim — §2 steps text over media to 65%.
            <span className="shell-b__tile-empty t-label-caps scrim-65">{caption}</span>
          )}
        </figcaption>
      ) : null}
    </figure>
  )
}

export function ShellB({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const chrome = useShellBChrome()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const reduced = useReducedMotion()

  // §9: the one licensed parallax. The work log is the scroll owner, so scroll
  // progress is read from it: backdrop drifts y −40 → 40, acrylic chrome at
  // 0.25× (−10 → 10). Held at 0 under reduced motion.
  const workLogRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ container: workLogRef })
  const backdropY = useTransform(scrollYProgress, [0, 1], [-40, 40], { clamp: false })
  const chromeY = useTransform(scrollYProgress, [0, 1], [-10, 10], { clamp: false })

  const title = chrome.title ?? viewTitleForPath(pathname)
  const connection: ShellBConnection | "unknown" = chrome.connection ?? "unknown"
  const tiles = chrome.wallTiles ?? EMPTY_WALL_TILES
  const instruments = chrome.instruments ?? []
  const unread = chrome.unreadCount ?? 0

  return (
    <MotionRoot>
      <div className="shell-b">
        {/* §4 overlay-layer is a shell region: toasts land bottom-left, right of
            the spine, so two 40px-blur surfaces never touch (§11.10). */}
        <ToastProvider>
          {/* §2 backdrop, z0: scrim + media (mesh default) + the parallax carrier. */}
          <div className="backdrop-layer shell-b__backdrop" aria-hidden="true">
            <div className="backdrop-scrim" />
            <motion.div
              className="backdrop-media backdrop-mesh shell-b__backdrop-media"
              style={reduced === true ? undefined : { y: backdropY }}
            />
          </div>

          <a className="skip-link" href="#shell-b-worklog">
            Skip to the work surface
          </a>

          {/* §4 spine — opaque secondary, 64px, glyph nav, fixed glyph strip. */}
          <nav className="shell-b__spine chrome-dark" aria-label="Console">
            <ul className="shell-b__spine-list">
              {NAV_ITEMS.map((item) => (
                <li key={item.path}>
                  <SpineNavItem item={item} active={isNavActive(pathname, item)} />
                </li>
              ))}
            </ul>
            <div className="shell-b__spine-foot">
              {/* §4 user glyph. Settings carries Account/Users/Clients (§5.11). */}
              <Link
                className="shell-b__account"
                to="/settings"
                title="Account and settings"
                aria-label="Account and settings"
              >
                <IconProfiles size={24} />
              </Link>
              {/* §4 WS LED: shape + name, never colour alone (hard law 7). */}
              <span
                className="shell-b__led"
                data-connection={connection}
                role="img"
                aria-label={CONNECTION_LABEL[connection]}
                title={CONNECTION_LABEL[connection]}
              />
            </div>
          </nav>

          {/* §4 command capsule — acrylic 0.55 / blur 40, radius 8, floating 24px. */}
          <motion.header
            className="shell-b__capsule acrylic acrylic--nav"
            style={reduced === true ? undefined : { y: chromeY }}
          >
            <span className="shell-b__wordmark t-label-caps opaque opaque--sm">MIRRORR</span>
            {/* The view title is the shell's h1; views own everything below it. */}
            <h1 className="shell-b__title">{title}</h1>
            {chrome.readout !== undefined ? (
              <span className="shell-b__readout t-label-caps opaque opaque--sm">{chrome.readout}</span>
            ) : null}
            <div className="shell-b__capsule-actions">
              {chrome.primaryAction}
              {chrome.onOpenNotifications !== undefined ? (
                <span className="shell-b__bell">
                  <Button
                    variant="ghost"
                    aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
                    onClick={chrome.onOpenNotifications}
                    icon={<IconBell size={20} />}
                  />
                  <span className="shell-b__bell-badge" aria-hidden="true">
                    <Badge variant="unread">{unread}</Badge>
                  </span>
                </span>
              ) : null}
            </div>
          </motion.header>

          {/* §4 the deck: instruments over bare media, then work-log + wall. */}
          <div className="shell-b__deck">
            {/* §4 instrument band: acrylic 0.64/16 plates, asymmetric spans.
                Empty without data — `.shell-b__instruments:empty` collapses it. */}
            <section className="shell-b__instruments" aria-label="Instrument band">
              {instruments.slice(0, 3).map((instrument) => (
                <article className="shell-b__plate acrylic acrylic--card" key={instrument.id}>
                  <span className="shell-b__plate-label">{instrument.label}</span>
                  <span className="shell-b__plate-value num">{instrument.value}</span>
                </article>
              ))}
            </section>

            <div className="shell-b__panes">
              {/* THE scroll owner of the view. Opaque `surface` slab (§2). */}
              <section
                className="shell-b__worklog panel opaque"
                id="shell-b-worklog"
                aria-label="Work surface"
                tabIndex={-1}
                ref={workLogRef}
              >
                {children}
              </section>

              {/* §4 monitor-wall: content, not ambience. Owns its own scroll. */}
              <aside className="shell-b__wall" aria-label="Monitor wall" tabIndex={0}>
                <div className="shell-b__wall-grid">
                  {tiles.map((tile) => (
                    <WallTile key={tile.id} tile={tile} />
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </ToastProvider>
      </div>
    </MotionRoot>
  )
}
