/**
 * shells/a — Variant A ("Safe"), the light frosted-acrylic control deck (§3).
 *
 * The orchestrator mounts `ShellA` inside the authenticated layout route; the
 * view arrives as `children` and renders inside the stage scroller.
 */
export { ShellA } from "./ShellA"
export { Backdrop, TallyBand, WordmarkPlate, ConnectionChip, UserMenu, Breadcrumb, BackdropSwitch } from "./parts"
export type { TallyPlate, NavSurface, BackdropProps, ConnectionChipProps, BackdropSwitchProps } from "./parts"
export { NAV_SURFACES, titleForPath, navSurfaceLabel } from "./parts"
