import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { ToastProvider } from "@/components/ui/Toast"
import { SessionsList } from "@/views/sessions/sessions-list"

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  useParams: () => ({}),
  Link: ({ children }: { children: unknown }) => children,
}))

describe("SessionsList initial-load skeleton", () => {
  it("shows skeletons while the first list fetch hangs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SessionsList />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const count = container.querySelectorAll(".skeleton").length
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
