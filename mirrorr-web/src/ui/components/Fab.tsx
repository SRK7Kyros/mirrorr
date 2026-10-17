import type { ReactNode } from "react"
import { motion, type HTMLMotionProps } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { motionTokens, springs } from "@/ui/lib/motion"

const FAB_CLASS =
  "hidden max-sm:inline-flex tab-stop items-center justify-center fixed right-4 bottom-[calc(var(--bottomnav-h)_+_env(safe-area-inset-bottom,0px)_+_var(--s-4))] w-[52px] h-[52px] rounded-full bg-brand text-brand-ink shadow-elev-lg z-[var(--z-sticky)] transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-brand-hover"

export interface FabProps extends HTMLMotionProps<"button"> {
  /** Accessible name — required (the icon alone carries no text). */
  readonly label: string
  readonly icon: ReactNode
}

/** Floating action button. Hidden above the phone breakpoint. */
export function Fab({ label, icon, type = "button", className, ...rest }: FabProps) {
  return (
    <motion.button
      {...rest}
      type={type}
      data-slot="fab"
      aria-label={label}
      title={label}
      className={cn(FAB_CLASS, className)}
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
