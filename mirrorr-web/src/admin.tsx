import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { setAuthNavigator } from "@/api/auth"
import { queryClient } from "@/api/query-client"
import { SettingsSectionsContext, type SettingsSection } from "@/ui/views/settings/sections"
import { router } from "@/router"
import { AdministrationSection } from "./admin-surface"
import "@/app.css"

/**
 * The admin entry renders the same app as `main.tsx` and adds the
 * administration section to the settings page; the standard entry imports
 * neither this file nor `admin-surface`, so neither appears in its bundle.
 */
const SECTIONS: readonly SettingsSection[] = [{ id: "administration", Component: AdministrationSection }]

setAuthNavigator({ toLogin: () => void router.navigate({ to: "/login" }) })

const container = document.getElementById("root")
if (container === null) throw new Error("#root missing")

createRoot(container).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <SettingsSectionsContext.Provider value={SECTIONS}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </SettingsSectionsContext.Provider>
    </MotionConfig>
  </StrictMode>,
)
