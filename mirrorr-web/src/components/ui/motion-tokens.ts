import type { Transition } from "motion/react"

/**
 * motion-tokens — the four pinned tokens from spec §1 (motion) / §9.
 * Every animated job maps to exactly one of these; numbers are never
 * re-invented at the call site (§9: "durations/stiffness are never
 * re-invented"). Import from `motion/react` and pass one token per
 * transition.
 */

/** §1 `micro` — spring(400/30). Press, knob slide, chip toggle, badge bump. */
export const micro: Transition = { type: "spring", stiffness: 400, damping: 30 }

/** §1 `ui` — spring(300/24). Menu/tab/nav opens, toast enter, error flash. */
export const ui: Transition = { type: "spring", stiffness: 300, damping: 24 }

/** §1 `page` — spring(350/35). Route change, shared-element morph, view enter. */
export const page: Transition = { type: "spring", stiffness: 350, damping: 35 }

/** §1 `tween-enter` — 0.2s easeOut. Dialog/drawer, toast exit, skeleton, spinner, pulse. */
export const tweenEnter: Transition = { duration: 0.2, ease: "easeOut" }

/** All four under their spec names (the token is literally "tween-enter"). */
export const motionTokens = { micro, ui, page, "tween-enter": tweenEnter } as const

export type MotionTokenName = keyof typeof motionTokens
