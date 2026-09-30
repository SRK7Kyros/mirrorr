/**
 * Spec L187 and contract §11.2/§13.10.2: one bell, one badge number built from
 * two components — REST unread rows plus unacknowledged synthetic frames
 * (tuple-deduped, never joined by `id`). No bell at all for an API-client
 * principal (spec L154).
 */
import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { NotificationDrawer } from "@/components/chrome/NotificationDrawer"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { getAuthState, isUserPrincipal, subscribeToAuth } from "@/lib/auth-store"
import { fetchNotifications } from "@/lib/notifications-api"
import {
  countPendingSyntheticNotifications,
  getSyntheticNotifications,
  notificationBadgeCount,
  subscribeToSyntheticNotifications,
} from "@/lib/notification-policy"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const principal = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)
  const synthetic = useSyncExternalStore(
    subscribeToSyntheticNotifications,
    getSyntheticNotifications,
    getSyntheticNotifications,
  )
  const visible = isUserPrincipal(principal)

  const query = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: ({ signal }) => fetchNotifications(signal),
    staleTime: QUERY_STALE_TIMES_MS.notifications,
    enabled: visible,
  })

  if (!visible) return null

  const rows = query.data ?? []
  const restUnread = rows.filter((row) => !row.read).length
  const syntheticPending = countPendingSyntheticNotifications(synthetic, rows)
  const badge = notificationBadgeCount({ restUnread, syntheticPending })

  return (
    <>
      <button
        type="button"
        data-testid="notification-bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${badge} unread notifications`}
        onClick={() => setOpen(true)}
        className={[
          "relative flex h-8 w-8 items-center justify-center rounded-control",
          "text-text-secondary hover:bg-bg-overlay hover:text-text-primary",
          FOCUS_RING,
        ].join(" ")}
      >
        <Bell aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
        {badge > 0 ? (
          <span
            data-testid="notification-badge"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-accent px-1 text-micro font-semibold text-bg-base"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
      <NotificationDrawer
        open={open}
        onClose={() => setOpen(false)}
        rows={rows}
        isLoading={query.isPending}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    </>
  )
}
