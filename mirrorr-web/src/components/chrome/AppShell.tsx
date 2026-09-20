/**
 * Spec L17-L23: the authenticated chrome — fixed sidebar, 48px top bar, health
 * banner, and the main region (24px padding, no max-width) — wrapped around
 * every authenticated view's `<Outlet/>`. The shell's region is a `<div>` so
 * each view keeps owning the single `<main>` landmark.
 */
import { Outlet } from "@tanstack/react-router"
import { CompactShellProvider, COMPACT_PRIMARY_ACTION_ID, useIsCompactShell } from "@/components/chrome/CompactShell"
import { HealthBannerHost } from "@/components/chrome/HealthBannerHost"
import { SidebarNav } from "@/components/chrome/SidebarNav"
import { TopBar } from "@/components/chrome/TopBar"

export function AppShell() {
  return (
    <CompactShellProvider>
      <AppShellFrame />
    </CompactShellProvider>
  )
}

function AppShellFrame() {
  const compact = useIsCompactShell()

  return (
    <div className="flex min-h-screen bg-bg-base text-text-primary">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <HealthBannerHost />
        <div data-testid="shell-main" className="flex-1 p-6">
          <Outlet />
        </div>
      </div>
      {compact ? (
        <div
          data-testid="compact-primary-action"
          id={COMPACT_PRIMARY_ACTION_ID}
          className="pointer-events-none fixed right-4 bottom-4 z-40 [&>*]:pointer-events-auto"
        />
      ) : null}
    </div>
  )
}
