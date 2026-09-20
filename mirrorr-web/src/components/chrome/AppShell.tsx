/**
 * Spec L17-L23 and L489-L491: the authenticated chrome, picked by the media
 * query — at ≥640px the fixed sidebar (224px, or the 56px rail) with the 48px
 * top bar; at ≤639px the 44px compact app bar, the 56px bottom tab bar, the
 * More sheet and the single 56px FAB. Both presentations wrap the same
 * `<Outlet/>`, and the region that holds it is a `<div>` so each view keeps
 * owning the single `<main>` landmark. The compact shell scrolls in exactly
 * one container (16px padding, hidden horizontal overflow).
 */
import { Outlet } from "@tanstack/react-router"
import { ApiClientBanner } from "@/components/chrome/ApiClientBanner"
import { CompactAppBar } from "@/components/chrome/CompactAppBar"
import { CompactFab } from "@/components/chrome/CompactFab"
import { CompactShellProvider, useIsCompactShell } from "@/components/chrome/CompactShell"
import { CompactTabBar } from "@/components/chrome/CompactTabBar"
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

  if (compact) {
    return (
      <div className="flex h-dvh flex-col overflow-x-hidden bg-bg-base text-text-primary">
        <CompactAppBar />
        <HealthBannerHost />
        <ApiClientBanner />
        <div
          data-testid="compact-scroll"
          className="flex-1 overflow-x-hidden overflow-y-auto p-4 pb-18"
        >
          <Outlet />
        </div>
        <CompactTabBar />
        <CompactFab />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-bg-base text-text-primary">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <HealthBannerHost />
        <ApiClientBanner />
        <div data-testid="shell-main" className="flex-1 p-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
