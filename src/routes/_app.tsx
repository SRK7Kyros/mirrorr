import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
  type MakeLinkOptions,
} from "@tanstack/react-router"
import { useAuthStore } from "@/stores/auth-store"
import { formatLocalDate } from "@/lib/utils"
import { useRequestLogStore } from "@/stores/request-log-store"
import { useTheme } from "next-themes"
import { useWsEvents } from "@/hooks/use-ws-events"
import { useWsNotifications } from "@/hooks/use-ws-notifications"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  LayoutDashboard,
  Radio,
  CalendarClock,
  Film,
  Settings,
  Plug,
  User,
  LogOut,
  Bell,
  Menu,
  X,
  CheckCircle,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { startTokenRefresh, stopTokenRefresh } from "@/lib/api"
import { NetworkStatusDot, NetworkMonitor, NetworkStatusTracker } from "@/components/network-monitor"
import { Logo } from "@/components/logo"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn, getUserInitial } from "@/lib/utils"

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    const { isAuthenticated, token } = useAuthStore.getState()
    if (!isAuthenticated || !token) {
      throw redirect({ to: "/login" })
    }
  },
  component: AppLayout,
})

interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Sessions", to: "/sessions", icon: Radio },
  { label: "Autoruns", to: "/autoruns", icon: CalendarClock },
  { label: "Recordings", to: "/recordings", icon: Film },
  { label: "Profiles", to: "/profiles", icon: Settings },
  { label: "Plugins", to: "/plugins", icon: Plug },
]

function NavItemComponent({ item, isActive, className }: { item: NavItem; isActive: boolean; className?: string }) {
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors",
        isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {item.label}
    </Link>
  )
}

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [netOpen, setNetOpen] = useState(false)
  const [netPos, setNetPos] = useState<{ x: number; y: number }>({ x: 80, y: 80 })
  const netTriggerRef = useRef<HTMLButtonElement>(null)
  const backendStatus = useRequestLogStore((s) => s.backendStatus)

  useWsEvents()
  const { notifications, markRead, clearAll } = useWsNotifications()

  // Start periodic token refresh when app loads
  useEffect(() => {
    startTokenRefresh()
    return () => stopTokenRefresh()
  }, [])

  // Redirect to login if auth is cleared while on this page
  useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (prev.isAuthenticated && !state.isAuthenticated) {
        navigate({ to: "/login" })
      }
    })
    return unsub
  }, [navigate])

  // Redirect to login after sustained disconnection
  useEffect(() => {
    if (backendStatus !== "disconnected") return
    const timer = setTimeout(() => {
      logout()
    }, 10_000) // 10s grace period
    return () => clearTimeout(timer)
  }, [backendStatus, logout])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const filteredNav = navItems

  return (
    <div className="h-screen grid grid-rows-[auto_1fr] bg-background overflow-hidden">
      {/* ── Top Navbar ────────────────────────────────────────── */}
      <header className="h-12 flex items-center border-b bg-background/80 backdrop-blur-xl">
        {/* Logo */}
        <div className="px-4 shrink-0 hidden sm:block">
          <Logo />
        </div>

        <Separator orientation="vertical" className="h-5 shrink-0 hidden sm:block" />

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1 px-3">
          {filteredNav.map((item) => {
            const isActive =
              item.to === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.to)
            return (
              <NavItemComponent key={item.to} item={item} isActive={isActive} />
            )
          })}
        </nav>

        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-0.5 pr-3">
          {/* Network status + monitor trigger */}
          <button
            ref={netTriggerRef}
            className="relative h-7 px-2 rounded-md border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer flex items-center"
            onClick={() => {
              if (!netOpen && netTriggerRef.current) {
                const rect = netTriggerRef.current.getBoundingClientRect()
                const winWidth = 420
                // Right-align: align right edge of window with right edge of button
                let x = rect.right - winWidth
                x = Math.max(8, Math.min(x, window.innerWidth - winWidth - 8))
                setNetPos({ x, y: rect.bottom + 8 })
              }
              setNetOpen(!netOpen)
            }}
          >
            <NetworkStatusDot />
            <span className="sr-only">Network Monitor</span>
          </button>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative" />}>
                <Bell className="size-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
                    {notifications.length > 9 ? "9+" : notifications.length}
                  </span>
                )}
                <span className="sr-only">Notifications</span>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="font-semibold text-sm">Notifications</h3>
                {notifications.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAll}>
                    Clear all
                  </Button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No new notifications
                </div>
              ) : (
                <ScrollArea className="h-72">
                  <div className="divide-y">
                    {notifications.map((notif) => (
                      <div key={notif.id} className="px-4 py-3 space-y-1 hover:bg-muted/50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight">{notif.title}</p>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 mt-0.5"
                            onClick={() => markRead(notif.id)}
                          >
                            <CheckCircle className="size-3" />
                          </Button>
                        </div>
                        {notif.body && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{notif.body}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70">
                          {notif.resource_type} · {formatLocalDate(notif.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </PopoverContent>
          </Popover>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="ml-1" />}>
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs bg-muted">
                    {getUserInitial(user)}
                  </AvatarFallback>
                </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{user?.display_name || user?.username}</span>
                  <span className="text-xs text-muted-foreground font-normal capitalize">{user?.role}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link to="/profile" />}>
                <User className="size-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  logout()
                }}
              >
                <LogOut className="size-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden ml-1"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </header>

      {/* ── Mobile nav ───────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 top-14 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
          <nav className="fixed top-14 inset-x-0 z-50 bg-background border-b p-3 md:hidden">
            <div className="space-y-1">
              {filteredNav.map((item) => {
                const isActive =
                  item.to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.to)
                return (
                  <NavItemComponent key={item.to} item={item} isActive={isActive} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm" />
                )
              })}
            </div>
          </nav>
        </>
      )}

      {/* ── Page content ─────────────────────────────────────── */}
      <main className="min-h-0 overflow-auto">
        <Outlet />
      </main>

      {/* ── Floating network monitor ─────────────────────────── */}
      <NetworkStatusTracker />
      <NetworkMonitor open={netOpen} onClose={() => setNetOpen(false)} defaultPos={netPos} />
    </div>
  )
}
