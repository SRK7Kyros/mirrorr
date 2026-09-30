import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useCallback, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { CompactAppBar } from "./CompactAppBar"
import { HealthBanner } from "./HealthBanner"
import { IconRail } from "./IconRail"
import { MoreSheet } from "./MoreSheet"
import { NotificationDrawer } from "./NotificationDrawer"
import type { NotificationItem } from "./NotificationDrawer"
import { Sidebar } from "./Sidebar"
import { TabBar } from "./TabBar"
import { TopBar } from "./TopBar"
import type { ConnectionState } from "./TopBar"
import { titleForPath } from "./nav-items"
import { Button } from "@/components/ui/Button"
import { useAuthState } from "@/hooks/use-auth-state"
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications"
import { useRealtimeState } from "@/hooks/use-realtime-state"
import { apiFetch } from "@/lib/api"
import {
  API_CLIENT_POLL_LABEL,
  apiClientBannerText,
  isApiClientPrincipal,
  logout,
} from "@/lib/auth"
import { retryRealtime, type RealtimeState } from "@/lib/realtime-manager"
import { formatRelativeTime } from "@/lib/time"

export interface AppShellProps {
  readonly children: ReactNode
  /** View-owned primary action, rendered as the compact FAB (§3.3). */
  readonly fab?: ReactNode
}

const HEALTH_KEY = ["health"] as const
const WS_FALLBACK_MESSAGE = "Live updates offline — polling every 15s"
const HEALTH_FAIL_MESSAGE = "API unreachable — retrying"
const HEALTH_RETRY_MS = 15_000
// string-typed: /settings lands on notFound until the settings wave registers it.
const settingsPath: string = "/settings"

interface HealthBannerSpec {
  readonly tone: "degraded" | "api-client"
  readonly message: string
  readonly action?: ReactNode
}

type Connection = {
  state: ConnectionState
  label: string
  hideDot?: boolean
}

function connectionFromRealtime(state: RealtimeState): Connection {
  if (state.pollingFallback || state.events === "polling") {
    return { state: "offline", label: "Polling" }
  }
  switch (state.events) {
    case "open":
      return { state: "connected", label: "Online" }
    case "connecting":
    case "reconnecting":
      return { state: "reconnecting", label: "Reconnecting" }
    case "closed":
    case "skipped":
    default:
      return { state: "offline", label: "Offline" }
  }
}

function notificationPath(resourceType: string): string | null {
  switch (resourceType) {
    case "session":
      return "/sessions"
    case "autorun":
      return "/autoruns"
    case "recording":
      return "/recordings"
    case "profile":
      return "/profiles"
    default:
      return null
  }
}

/**
 * AppShell — §3 anatomy + scroll ownership, self-wired: realtime conn dot
 * (subscribeRealtimeState), health banners (WS polling fallback / boot
 * /health probe / API-client principal), REST notifications (bell badge +
 * drawer), account menu (display name → Change password / Log out).
 */
export function AppShell({ children, fab }: AppShellProps) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const authState = useAuthState()
  const realtime = useRealtimeState()
  const notificationsQuery = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const deleteNotification = useDeleteNotification()

  const healthQuery = useQuery({
    queryKey: HEALTH_KEY,
    queryFn: () => apiFetch<unknown>("/health"),
    retry: 1,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.status === "error" ? HEALTH_RETRY_MS : false),
  })

  const principal = authState.auth
  const isApi = isApiClientPrincipal(principal)
  const userLabel =
    principal?.user?.display_name ||
    principal?.user?.username ||
    principal?.client?.name ||
    "Admin"

  const connection: Connection = useMemo(() => {
    if (isApi) {
      return { state: "connected", label: API_CLIENT_POLL_LABEL, hideDot: true }
    }
    return connectionFromRealtime(realtime)
  }, [isApi, realtime])

  const banners: HealthBannerSpec[] = useMemo(() => {
    const list: HealthBannerSpec[] = []
    if (realtime.pollingFallback) {
      list.push({ tone: "degraded", message: WS_FALLBACK_MESSAGE })
    } else if (healthQuery.isError) {
      list.push({ tone: "degraded", message: HEALTH_FAIL_MESSAGE })
    }
    const client = principal?.client
    if (isApi && client != null) {
      list.push({ tone: "api-client", message: apiClientBannerText(client.name) })
    }
    return list
  }, [healthQuery.isError, isApi, principal?.client, realtime.pollingFallback])

  const notifications = useMemo<ReadonlyArray<NotificationItem>>(
    () =>
      (notificationsQuery.data ?? []).map((row) => ({
        id: String(row.id),
        title: row.title,
        timeLabel: formatRelativeTime(row.created_at),
        unread: row.read !== true,
      })),
    [notificationsQuery.data],
  )

  const unreadCount = notifications.reduce(
    (count, item) => (item.unread ? count + 1 : count),
    0,
  )

  const handleSignOut = useCallback(async (): Promise<void> => {
    await logout()
    await navigate({ to: "/login" })
  }, [navigate])

  const handleChangePassword = useCallback((): void => {
    void navigate({ to: settingsPath })
  }, [navigate])

  const handleOpenNotification = useCallback(
    (item: NotificationItem): void => {
      markRead.mutate(Number(item.id))
      const row = (notificationsQuery.data ?? []).find((entry) => String(entry.id) === item.id)
      if (row !== undefined) {
        const path = notificationPath(row.resource_type)
        if (path !== null) void navigate({ to: path })
      }
      setDrawerOpen(false)
    },
    [markRead, navigate, notificationsQuery.data],
  )

  return (
    <div className="shell">
      <div className="shell__sidebar">
        <Sidebar />
      </div>
      <div className="shell__rail">
        <IconRail />
      </div>
      <div className="shell__topbar">
        <TopBar
          title={titleForPath(pathname)}
          connection={connection}
          notificationCount={unreadCount}
          onOpenNotifications={() => setDrawerOpen(true)}
          hideNotifications={isApi}
          userLabel={userLabel}
          onSignOut={handleSignOut}
          onChangePassword={handleChangePassword}
        />
      </div>
      <div className="shell__appbar">
        <CompactAppBar
          title={titleForPath(pathname)}
          connection={connection}
          notificationCount={unreadCount}
          onOpenNotifications={() => setDrawerOpen(true)}
          hideNotifications={isApi}
          showMark={pathname === "/sessions"}
        />
      </div>
      {banners.length > 0 ? (
        <div className="shell__health">
          {banners.map((banner) => (
            <HealthBanner
              key={banner.message}
              tone={banner.tone}
              message={banner.message}
              action={
                banner.message === WS_FALLBACK_MESSAGE ? (
                  <Button variant="ghost" onClick={() => retryRealtime()}>
                    Retry
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : null}
      <main className="shell__main" id="main-content">
        {children}
      </main>
      <div className="shell__tabbar">
        <TabBar pathname={pathname} onOpenMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
      </div>
      {fab}
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onChangePassword={handleChangePassword}
        onSignOut={handleSignOut}
      />
      <NotificationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={notifications}
        onMarkAllRead={() => markAllRead.mutate()}
        onOpenItem={handleOpenNotification}
        onDeleteItem={(item) => deleteNotification.mutate(Number(item.id))}
      />
    </div>
  )
}
