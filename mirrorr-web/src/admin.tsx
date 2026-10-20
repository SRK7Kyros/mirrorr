import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { setAuthNavigator } from "@/api/auth"
import { installShellBackHandler } from "@/api/native"
import { queryClient } from "@/api/query-client"
import { SettingsSectionsContext, type SettingsSection } from "@/ui/views/settings/sections"
import { ResourceAccessSlotContext } from "@/ui/views/shared/resource-access-slot"
import { TabStopMap } from "@/ui/components/tab-stops"
import { router } from "@/router"
import { ADMIN_ACCESS_SLOT } from "./admin-access"
import { AdministrationSection } from "./admin-surface"
import "@/app.css"

/**
 * The admin entry renders the same app as `main.tsx` and adds the
 * administration section to the settings page; the standard entry imports
 * neither this file, `admin-surface` nor `admin-access`, so none of them
 * appears in its bundle. The access slot is how the shared list views reach the
 * per-element affordances without knowing this entry exists.
 */
const SECTIONS: readonly SettingsSection[] = [{ id: "administration", Component: AdministrationSection }]

setAuthNavigator({ toLogin: () => void router.navigate({ to: "/login" }) })
installShellBackHandler()

const container = document.getElementById("root")
if (container === null) throw new Error("#root missing")

createRoot(container).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TabStopMap />
      <SettingsSectionsContext.Provider value={SECTIONS}>
        <ResourceAccessSlotContext.Provider value={ADMIN_ACCESS_SLOT}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ResourceAccessSlotContext.Provider>
      </SettingsSectionsContext.Provider>
    </MotionConfig>
  </StrictMode>,
)
