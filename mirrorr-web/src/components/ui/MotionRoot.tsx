import { MotionConfig } from "motion/react"
import type { ReactNode } from "react"

/**
 * MotionRoot — §9 root requirement: `<MotionConfig reducedMotion="user">` is
 * mandatory so `prefers-reduced-motion: reduce` drops transform/layout
 * animation while keeping the 0.2s tween-enter opacity drops. The shell wave
 * mounts this once at the app root (main.tsx is owned by that wave).
 */
export function MotionRoot({ children }: { readonly children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
