import React from "react"
import ReactDOM from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { useAuthStore } from "@/stores/auth-store"
import { routeTree } from "./routeTree.gen"
import "./index.css"

const router = createRouter({
  routeTree,
  context: {
    auth: {
      token: null,
      isAuthenticated: false,
      userRole: null,
    },
  },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

function App() {
  const token = useAuthStore((s) => s.token)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)

  return (
    <RouterProvider
      router={router}
      context={{
        auth: {
          token,
          isAuthenticated,
          userRole: user?.role ?? null,
        },
      }}
    />
  )
}

const rootElement = document.getElementById("root")!
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
