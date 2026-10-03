import { createContext, useContext } from "react"
import type { ReactNode } from "react"

/**
 * slots — the one seam Variant B needs to stay "pure chrome plus slots" (§0/§4).
 *
 * The shell must not import views, routes or data hooks, yet §4 gives its
 * regions data-shaped content: a capsule readout, an instrument band, wall
 * tiles. Those arrive through this optional context instead. Nothing here
 * fetches, and with no provider mounted the shell renders its own empty-DB
 * states (§2.3 mesh + "no live sources"), so `<ShellB>{children}</ShellB>`
 * is always a complete, honest deck.
 */

/** §4/§11.29: wall tiles are irregular — one hero plus smaller tiles. */
export interface ShellBWallTile {
  readonly id: string
  /** Short label (e.g. a source tail). Omitted by the empty-database default. */
  readonly label?: string
  /**
   * A still frame only. §2.3/API 13.11.5: posters are link-only media, so this
   * is never a `<video>`/HLS source — see "QA cost bound" in shell-b.css.
   */
  readonly posterUrl?: string
  /** The 2x2 mosaic slot. Never three equal cards (§4/§11.29). */
  readonly hero?: boolean
}

/** §4 instrument band: short, label-level readouts on acrylic plates. */
export interface ShellBInstrument {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** §3/§1.4 WS connection vocabulary (Live / Polling / Offline). */
export type ShellBConnection = "live" | "polling" | "offline"

export interface ShellBChrome {
  /** View title; derived from the route when omitted. */
  readonly title?: string
  /** One `label-caps` readout on an opaque mini-chip (e.g. "3 RECORDING · 1 REMUXING"). */
  readonly readout?: string
  /** WS mode for the spine's LED. */
  readonly connection?: ShellBConnection
  /** Drives the bell badge; 0 renders nothing (§11.28). */
  readonly unreadCount?: number
  /** The view's ONE primary action (§4/§6.1). */
  readonly primaryAction?: ReactNode
  /** Countdown / tally / health plates (§4). First three render, by span. */
  readonly instruments?: readonly ShellBInstrument[]
  /** Live stills for the monitor-wall. Omitted ⇒ the empty-DB mesh tiles. */
  readonly wallTiles?: readonly ShellBWallTile[]
  /** Bell handler. Omitted ⇒ no bell is rendered (never a dead control). */
  readonly onOpenNotifications?: () => void
}

const ShellBChromeContext = createContext<ShellBChrome>({})

export function ShellBChromeProvider({
  chrome,
  children,
}: {
  readonly chrome: ShellBChrome
  readonly children: ReactNode
}) {
  return <ShellBChromeContext.Provider value={chrome}>{children}</ShellBChromeContext.Provider>
}

/** Default chrome: `{}` — every region falls back to its spec'd empty state. */
export function useShellBChrome(): ShellBChrome {
  return useContext(ShellBChromeContext)
}
