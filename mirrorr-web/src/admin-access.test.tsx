import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { BulkAccessAction, ResourceAccessButton } from "./admin-access"

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchResourceAccess: vi.fn(),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}))

vi.mock("@/api", () => api)
// The panel and the planner read the endpoint module directly, not the barrel.
vi.mock("@/api/endpoints/access", () => api)

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
]

/** The affordances live inside a clickable card, so every test mounts them in one. */
function renderInCard(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const openCard = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <div data-testid="card" onClick={openCard}>
        {node}
      </div>
    </QueryClientProvider>,
  )
  return openCard
}

describe("access affordances keep their clicks off the card", () => {
  function accessView() {
    return { resource_type: "session", id: 7, owner: "kyros", owner_missing: false, grants: [] }
  }

  it("swallows a click on the button and on the panel", async () => {
    api.fetchUsers.mockResolvedValue(USERS)
    api.fetchResourceAccess.mockResolvedValue(accessView())
    const openCard = renderInCard(
      <ResourceAccessButton resourceType="session" id={7} label="F1 Weekend" />,
    )

    fireEvent.click(screen.getByTestId("card"))
    expect(openCard).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Access for F1 Weekend" }))
    expect(openCard).toHaveBeenCalledTimes(1)

    fireEvent.click(await screen.findByText("Access · F1 Weekend"))
    expect(openCard).toHaveBeenCalledTimes(1)
  })

  it("mounts one centered dialog panel, not a sheet, and keeps its body clicks off the card", async () => {
    api.fetchUsers.mockResolvedValue(USERS)
    api.fetchResourceAccess.mockResolvedValue(accessView())
    const openCard = renderInCard(
      <ResourceAccessButton resourceType="session" id={7} label="F1 Weekend" />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Access for F1 Weekend" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Access · F1 Weekend")).toBeTruthy()
    expect(within(dialog).getByText("Session · #7")).toBeTruthy()
    expect(openCard).toHaveBeenCalledTimes(0)

    fireEvent.click(await within(dialog).findByLabelText("Search users"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Change" }))
    fireEvent.click(within(dialog).getByTestId("access-catalog"))
    expect(openCard).toHaveBeenCalledTimes(0)
  })

  it("swallows a click on the bulk panel", async () => {
    api.fetchUsers.mockResolvedValue(USERS)
    api.fetchResourceAccess.mockResolvedValue(accessView())
    const openCard = renderInCard(
      <BulkAccessAction resourceType="autorun" items={[{ id: 5, label: "F1 Race" }]} />,
    )

    fireEvent.click(screen.getByTestId("card"))
    expect(openCard).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Access" }))
    expect(openCard).toHaveBeenCalledTimes(1)

    fireEvent.click(await screen.findByText("Access on 1 item(s)"))
    expect(openCard).toHaveBeenCalledTimes(1)
  })
})
