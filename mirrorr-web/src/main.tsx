import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/app.css"
import { queryClient } from "@/query-client"
import { router } from "@/router"

// Scaffold boot: providers + router only. The env boot-guard, auth session
// seam, realtime manager, event table and notification pipeline wire in here
// as their waves land (see architecture brief "Scaffold shape").
const container = document.getElementById("root")

if (!container) {
  throw new Error("Mirrorr web root element #root is missing from the document")
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
