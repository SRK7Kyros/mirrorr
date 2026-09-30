import { createRootRoute, Outlet } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { ToastProvider } from "@/components/ui/Toast"

export const rootRoute = createRootRoute({
  component: RootLayout,
})

/** Root shell: §7 requires MotionConfig reducedMotion="user" tree-wide;
 *  §3.1 puts the toast viewport at the root (chrome wave). */
function RootLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </MotionConfig>
  )
}
