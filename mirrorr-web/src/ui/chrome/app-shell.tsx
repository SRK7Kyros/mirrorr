import { useEffect } from "react"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { installEventTable } from "@/api"
import { ToastRegion, toast } from "@/ui/components"
import { BottomNav } from "./bottom-nav"
import { ApiClientBanner, HealthBanner } from "./health-banner"
import { PageTransition } from "./page-transition"
import { Sidebar } from "./sidebar"
import { TopBar } from "./topbar"

function highlightFromPath(to: string): number | undefined {
  const query = to.split("?")[1]
  if (query === undefined) return undefined
  const raw = new URLSearchParams(query).get("highlight")
  if (raw === null) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function AppShell() {
  const navigate = useNavigate()

  useEffect(() => {
    return installEventTable({
      navigate: (to) => {
        if (to === "/sessions" || to === "/autoruns") void navigate({ to })
      },
      toast: (event) => {
        const { kind, message, action } = event
        const toastAction =
          action === undefined
            ? undefined
            : {
                label: action.label,
                onClick: () => {
                  void navigate({ to: "/recordings", search: { highlight: highlightFromPath(action.to) } })
                },
              }
        if (kind === "success") toast.success(message, undefined, toastAction)
        else if (kind === "error") toast.error(message, undefined, toastAction)
        else toast.info(message, undefined, toastAction)
      },
    })
  }, [navigate])

  return (
    <>
      <div className="grid min-h-dvh grid-cols-[var(--sidebar-w)_minmax(0,1fr)] pl-[var(--safe-left)] pr-[var(--safe-right)] max-lg:grid-cols-[var(--sidebar-rail-w)_minmax(0,1fr)] max-sm:block">
        <Sidebar />
        <div className="flex min-h-dvh min-w-0 flex-col pb-[var(--safe-bottom)] max-sm:pb-[calc(var(--bottomnav-h)_+_var(--safe-bottom)_+_var(--s-16))]">
          <TopBar />
          <ApiClientBanner />
          <HealthBanner />
          <PageTransition>
            <Outlet />
          </PageTransition>
          <BottomNav />
        </div>
      </div>
      <ToastRegion />
    </>
  )
}
