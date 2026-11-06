import { useEffect, useRef } from "react"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { installEventTable } from "@/api"
import { ToastRegion, toast } from "@/ui/components"
import { BottomNav } from "./bottom-nav"
import { ApiClientBanner, HealthBanner } from "./health-banner"
import { describeRoute } from "./breadcrumb"
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
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const crumb = describeRoute(pathname)

  // A client-side navigation replaces the whole page without moving focus, so a
  // keyboard or screen-reader user is left on the link they clicked. Move focus
  // into the new page and announce it once. The *first* render is skipped: a
  // fresh load already starts at the top of the document, and stealing focus
  // into `<main>` there would hide the rail from the first Tab press.
  const seenPath = useRef<string | null>(null)
  useEffect(() => {
    const previous = seenPath.current
    seenPath.current = pathname
    if (previous === null || previous === pathname) return
    const main = document.getElementById("page-main")
    main?.focus({ preventScroll: false })
  }, [pathname])

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
      <a
        href="#page-main"
        className="tab-stop sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--z-popover)] focus:rounded-sm focus:border focus:border-line-strong focus:bg-surface-3 focus:px-3 focus:py-2 focus:text-base focus:text-ink"
      >
        Skip to content
      </a>
      <p className="sr-only" role="status" aria-live="polite">
        {crumb.parent === null ? crumb.current : `${crumb.parent}, ${crumb.current}`}
      </p>
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
