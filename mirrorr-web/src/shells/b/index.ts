/**
 * Variant B — "Experimental" (§4). Mount `<ShellB>{view}</ShellB>`; `children`
 * render into the work log (the reading surface). Optional chrome content is
 * injected with `<ShellBChromeProvider chrome={...}>`.
 */
export { ShellB } from "./ShellB"
export { ShellBChromeProvider, useShellBChrome } from "./slots"
export type {
  ShellBChrome,
  ShellBConnection,
  ShellBInstrument,
  ShellBWallTile,
} from "./slots"
export { NAV_ITEMS, isNavActive, viewTitleForPath } from "./nav"
export type { ShellBNavItem, ShellBNavPath } from "./nav"
