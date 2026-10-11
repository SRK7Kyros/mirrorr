import type { ReactNode } from "react"
import { motion } from "motion/react"
import { useRouterState } from "@tanstack/react-router"
import { pageVariants } from "@/ui/lib/motion"

/**
 * Re-mounts the routed view on every pathname change so it lifts in. Keyed by
 * pathname (not search) — filtering the same page must not re-animate it.
 */
export function PageTransition({ children }: { readonly children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <motion.div
      key={pathname}
      className="flex min-w-0 flex-1 flex-col"
      variants={pageVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  )
}
