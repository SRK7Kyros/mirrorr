import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { ToastViewport } from "@/components/ui/ToastViewport"
import {
  SESSION_EXPIRED_MESSAGE,
  consumeSessionExpired,
  getAuthState,
  subscribeToAuth,
} from "@/lib/auth-store"
import { showToast } from "@/lib/toast"

export const rootRoute = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const sessionExpired = useSyncExternalStore(
    subscribeToAuth,
    () => getAuthState().sessionExpired,
    () => false,
  )
  const announced = useRef(false)

  useEffect(() => {
    if (!sessionExpired) {
      announced.current = false
      return
    }
    if (announced.current) return
    announced.current = true
    showToast(SESSION_EXPIRED_MESSAGE)
    consumeSessionExpired()
  }, [sessionExpired])

  return (
    <>
      <Outlet />
      <ToastViewport />
    </>
  )
}
