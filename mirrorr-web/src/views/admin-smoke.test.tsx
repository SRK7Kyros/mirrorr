import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "@/components/ui/Toast"

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  useLocation: () => ({ pathname: "/settings", search: {} }),
  useRouterState: (options: { select?: (state: unknown) => unknown } = {}) =>
    options.select ? options.select({ location: { pathname: "/nope" } }) : { location: { pathname: "/nope" } },
  Link: ({ children }: { children: unknown }) => children,
  Outlet: () => null,
}))

vi.mock("@/lib/auth", () => ({ isAdmin: () => true }))

let fetchedPaths: string[] = []

beforeEach(() => {
  fetchedPaths = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      fetchedPaths.push(url)
      return new Promise(() => {})
    }),
  )
})

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  )
}

describe("PluginsView", () => {
  it("requests both engines and resolvers and shows loading skeletons", async () => {
    const { PluginsView } = await import("@/views/plugins/plugins")
    const { container } = renderWithProviders(<PluginsView />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchedPaths.some((path) => path.includes("/engines"))).toBe(true)
    expect(fetchedPaths.some((path) => path.includes("/resolvers"))).toBe(true)
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThanOrEqual(1)
  })
})

describe("SettingsView", () => {
  it("renders the three admin tabs for an admin", async () => {
    const { SettingsView } = await import("@/views/settings/settings-view")
    renderWithProviders(<SettingsView />)
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Account" })).toBeTruthy()
    })
    expect(screen.getByRole("tab", { name: "Users" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Clients" })).toBeTruthy()
  })
})

describe("NotFoundView", () => {
  it("shows the console copy and the attempted path", async () => {
    const { NotFoundView } = await import("@/views/auth/not-found-view")
    renderWithProviders(<NotFoundView />)
    expect(screen.getByText("No console at this address.")).toBeTruthy()
    expect(screen.getByText("/nope")).toBeTruthy()
  })
})
