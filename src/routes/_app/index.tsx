import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { sessionsApi, recordingsApi, profilesApi, autorunsApi } from "@/lib/api"
import { Radio, Film, Settings, CalendarClock, Plug } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => sessionsApi.list() as Promise<any[]>,
  })
  const { data: recordings = [] } = useQuery({
    queryKey: ["recordings"],
    queryFn: () => recordingsApi.list() as Promise<any[]>,
  })
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesApi.list() as Promise<any[]>,
  })

  const active = sessions.filter((s: any) => s.status === "active" || s.status === "recording")

  const quickActions = [
    { label: "Sessions", href: "/sessions", icon: Radio, bg: "bg-blue-600", text: "text-blue-100" },
    { label: "Autoruns", href: "/autoruns", icon: CalendarClock, bg: "bg-emerald-600", text: "text-emerald-100" },
    { label: "Recordings", href: "/recordings", icon: Film, bg: "bg-amber-600", text: "text-amber-100" },
    { label: "Profiles", href: "/profiles", icon: Settings, bg: "bg-violet-600", text: "text-violet-100" },
    { label: "Plugins", href: "/plugins", icon: Plug, bg: "bg-rose-600", text: "text-rose-100" },
  ]

  return (
    <div className="h-full p-2 flex flex-col gap-2">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[
          { label: "Active Sessions", value: active.length, color: "bg-emerald-500" },
          { label: "Recordings", value: recordings.length, color: "bg-orange-500" },
          { label: "Profiles", value: profiles.length, color: "bg-cyan-500" },
          { label: "Scheduled Autoruns", value: sessions.length, color: "bg-purple-500" },
        ].map((stat) => (
          <div key={stat.label} className="border rounded-xl p-3 bg-card flex items-center gap-3">
            <div className={cn("size-2 rounded-full shrink-0", stat.color)} />
            <div>
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              <p className="text-lg font-bold tabular-nums">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main area */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_360px] gap-2">
        {/* Quick actions */}
        <div className="border rounded-xl bg-card p-3 flex flex-col">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 shrink-0">Quick Actions</p>
          <div className="flex-1 grid grid-cols-5 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <Link
                  key={action.href}
                  to={action.href}
                  className={cn(
                    "group rounded-xl flex flex-col items-center justify-center gap-3 transition-all hover:scale-[1.03] hover:shadow-lg",
                    action.bg
                  )}
                >
                  <Icon className="size-6 text-white" />
                  <span className={cn("text-xs font-medium", action.text)}>{action.label}</span>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Recent sessions */}
        <div className="border rounded-xl bg-card p-3 flex flex-col min-h-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 shrink-0">Recent Sessions</p>
          <div className="flex-1 min-h-0 overflow-auto">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 py-4 text-center">No sessions yet</p>
            ) : (
              <div className="divide-y rounded-lg overflow-hidden border">
                {sessions.slice(0, 8).map((session: any) => (
                  <Link
                    key={session.id}
                    to="/sessions"
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
                  >
                    <div className={cn("size-1.5 rounded-full shrink-0",
                      session.status === "active" ? "bg-emerald-500" :
                      session.status === "recording" ? "bg-amber-500" :
                      session.status === "completed" ? "bg-blue-500" :
                      session.status === "failed" ? "bg-red-500" : "bg-muted-foreground/30"
                    )} />
                    <span className="font-medium">#{session.id}</span>
                    <span className="text-muted-foreground ml-auto">{session.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
