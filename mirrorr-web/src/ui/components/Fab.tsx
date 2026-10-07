import type { ReactNode } from "react"
import { motion, type HTMLMotionProps } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { motionTokens, springs } from "@/ui/lib/motion"

export interface FabProps extends HTMLMotionProps<"button"> {
  /** Accessible name — required (the icon alone carries no text). */
  readonly label: string
  readonly icon: ReactNode
}

/** Floating action button — `.fab`. Hidden above the phone breakpoint. */
export function Fab({ label, icon, type = "button", className, ...rest }: FabProps) {
  return (
    <motion.button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cn("fab", className)}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: motionTokens.scale.pop }}
      whileTap={{ scale: motionTokens.scale.press }}
      transition={springs.bouncy}
    >
      {icon}
    </motion.button>
  )
}
