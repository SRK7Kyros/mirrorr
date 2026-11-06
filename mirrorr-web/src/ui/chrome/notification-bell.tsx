import { useRef, useState } from "react"
import { useAuthState, useNotifications } from "@/api"
import { IconBell, IconButton } from "@/ui/components"
import { NotificationDrawer, type NotificationQuery } from "./notification-drawer"

/**
 * The bell owns the notification query and the open state; the drawer renders
 * its three states (`CMP-08`) rather than only the rows.
 *
 * Focus is handed back explicitly: Radix restores to the element it captured
 * on mount, which for a portalled panel can be the panel's own close button
 * rather than the bell that opened it. Capturing the opener here and focusing
 * it after the close settles makes Escape land on the bell.
 */
export function NotificationBell() {
  const auth = useAuthState()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  if (auth.auth?.user == null) return null

  const items = notifications.data ?? []
  const unread = items.filter((item) => item.read !== true).length

  const query: NotificationQuery = {
    data: notifications.data,
    isLoading: notifications.isLoading,
    isError: notifications.isError,
    error: notifications.error,
    refetch: () => notifications.refetch(),
  }

  const openDrawer = () => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }

  const closeDrawer = () => {
    setOpen(false)
    const opener = openerRef.current
    openerRef.current = null
    if (opener === null) return
    requestAnimationFrame(() => {
      if (opener.isConnected) opener.focus()
    })
  }

  return (
    <>
      <span className="relative">
        <IconButton
          label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          icon={<IconBell size={18} />}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openDrawer}
        />
        {unread > 0 ? (
          <span
            className="absolute -right-[3px] -top-[3px] grid h-4 min-w-4 place-content-center rounded-full border-2 border-canvas bg-danger px-1 text-[9px] font-bold leading-none text-danger-ink [font-family:var(--font-mono)]"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
      <NotificationDrawer
        open={open}
        onClose={closeDrawer}
        onNavigate={() => setOpen(false)}
        query={query}
      />
    </>
  )
}
