import type { Transition, Variants } from "motion/react"

type Bezier = [number, number, number, number]

/**
 * Motion values, mirrored from the CSS tokens in `styles/tokens.css`
 * (`--dur-*`, `--ease-*`). The CSS tokens stay the single design-system
 * source; these are the JS counterparts motion needs. Never invent a new
 * duration/easing in a component — import it from here.
 */
export const motionTokens = {
  duration: { instant: 0.08, fast: 0.14, normal: 0.22, slow: 0.36 },
  easing: {
    smooth: [0.16, 1, 0.3, 1] as Bezier,
    inOut: [0.65, 0, 0.35, 1] as Bezier,
    spring: [0.34, 1.56, 0.64, 1] as Bezier,
  },
  distance: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
  scale: { subtle: 0.98, press: 0.97, pop: 1.03 },
}

/** Named spring presets — the only springs a component should use. */
export const springs: Record<"snappy" | "gentle" | "bouncy" | "instant", Transition> = {
  snappy: { type: "spring", stiffness: 300, damping: 30 },
  gentle: { type: "spring", stiffness: 120, damping: 14 },
  bouncy: { type: "spring", stiffness: 400, damping: 10 },
  instant: { type: "spring", stiffness: 600, damping: 35 },
}

const tween = (duration: number): Transition => ({ duration, ease: motionTokens.easing.smooth })

/** Scrim / backdrop — opacity only. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tween(motionTokens.duration.fast) },
  exit: { opacity: 0, transition: tween(motionTokens.duration.fast) },
}

/** Centred modal panel. */
export const dialogVariants: Variants = {
  hidden: { opacity: 0, scale: motionTokens.scale.subtle, x: "-50%", y: "-50%" },
  visible: { opacity: 1, scale: 1, x: "-50%", y: "-50%", transition: springs.gentle },
  exit: {
    opacity: 0,
    scale: motionTokens.scale.subtle,
    x: "-50%",
    y: "-50%",
    transition: tween(motionTokens.duration.fast),
  },
}

/** Slide-over panel — travels in from its own edge. */
export const drawerVariants = (side: "left" | "right"): Variants => {
  const offset = side === "right" ? "100%" : "-100%"
  return {
    hidden: { x: offset },
    visible: { x: 0, transition: tween(motionTokens.duration.normal) },
    exit: { x: offset, transition: tween(motionTokens.duration.normal) },
  }
}

/** Anchored popover — drops down or rises up from its trigger. */
export const menuVariants = (placement: "down" | "up"): Variants => {
  const offset = placement === "down" ? -motionTokens.distance.xs : motionTokens.distance.xs
  return {
    hidden: { opacity: 0, y: offset, scale: motionTokens.scale.subtle },
    visible: { opacity: 1, y: 0, scale: 1, transition: tween(motionTokens.duration.fast) },
    exit: {
      opacity: 0,
      y: offset,
      scale: motionTokens.scale.subtle,
      transition: tween(motionTokens.duration.instant),
    },
  }
}

/** Toast card — slides in from the right edge. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, x: motionTokens.distance.xl, scale: motionTokens.scale.subtle },
  visible: { opacity: 1, x: 0, scale: 1, transition: springs.snappy },
  exit: {
    opacity: 0,
    x: motionTokens.distance.xl,
    scale: motionTokens.scale.subtle,
    transition: tween(motionTokens.duration.fast),
  },
}

/** Route content — a short lift on every navigation. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: { opacity: 1, y: 0, transition: tween(motionTokens.duration.normal) },
}

/** Parent for a staggered list; pair with `staggerItem` on each child. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
}

/** Child of `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
}
