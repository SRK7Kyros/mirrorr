import { useState } from "react"
import { useAuthState, useNotifications } from "@/api"
import { IconBell, IconButton } from "@/ui/components"
import { NotificationDrawer } from "./notification-drawer"

export function NotificationBell() {
  const auth = useAuthState()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)

  if (auth.auth?.user == null) return null

  const items = notifications.data ?? []
  const unread = items.filter((item) => item.read !== true).length

  return (
    <>
      <span className="icon-badge-wrap">
        <IconButton
          label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          icon={<IconBell size={18} />}
          onClick={() => setOpen(true)}
        />
        {unread > 0 ? (
          <span className="icon-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </span>
      <NotificationDrawer open={open} onClose={() => setOpen(false)} items={items} />
    </>
  )
}
