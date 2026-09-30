import { QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { installAuthSession } from "@/lib/auth-store"
import { queryClient } from "@/query-client"

/**
 * Renders `ui` inside a real TanStack Router (memory history) and the shared
 * QueryClient, with the auth-session navigation wiring installed the same way
 * `main.tsx` does. The route table carries exactly the paths the chrome links
 * to, so `<Link>`/`useNavigate` resolve exactly as in the app.
 */
const TEST_PATHS = [
  "/sessions",
  "/sessions/$sessionId",
  "/autoruns",
  "/autoruns/$autorunId",
  "/recordings",
  "/profiles",
  "/plugins",
  "/import-export",
  "/settings",
  "/settings/users",
  "/settings/clients",
  "/login",
] as const

export async function renderInRouter(ui: ReactNode, initialPath = "/sessions", outlet: ReactNode = null) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const routes = TEST_PATHS.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <>{outlet}</> }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  await router.load()

  installAuthSession({
    navigateToLogin: (redirectPath) => {
      void router.navigate({ to: "/login", search: { redirect: redirectPath } })
    },
    getCurrentHref: () => router.state.location.href,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { router }
}
