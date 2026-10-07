import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { setAuthNavigator } from "@/api/auth"
import { queryClient } from "@/api/query-client"
import { router } from "@/router"
import "@/app.css"

// The API layer owns no router — the UI injects how to reach the login screen.
setAuthNavigator({ toLogin: () => void router.navigate({ to: "/login" }) })

const rootElement = document.getElementById("root")
if (rootElement === null) throw new Error("Mirrorr: #root element is missing")

createRoot(rootElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
)
