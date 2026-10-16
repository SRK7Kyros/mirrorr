import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { AdministrationSection } from "./admin-surface"

const api = vi.hoisted(() => ({
  approveRegistrationRequest: vi.fn(),
  createClient: vi.fn(),
  createUser: vi.fn(),
  deleteClient: vi.fn(),
  deleteUser: vi.fn(),
  denyRegistrationRequest: vi.fn(),
  fetchClients: vi.fn(),
  fetchRegistrationRequests: vi.fn(),
  fetchUsers: vi.fn(),
  formatRelativeTime: vi.fn((value: string) => value),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
  fetchAdminResources: vi.fn(),
  fetchResourceAccess: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
  setResourceOwner: vi.fn(),
}))

vi.mock("@/api", () => api)
// The access planner fans out over the endpoint module itself (importing the
// barrel from a domain module would close a cycle), so it needs its own double.
vi.mock("@/api/endpoints/access", () => api)

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
]

interface ResourceOverrides {
  readonly resource_type?: string
  readonly id?: number
  readonly label?: string
  readonly owner?: string
  readonly owner_missing?: boolean
  readonly viewer_count?: number
  readonly system?: boolean
}

function resource(overrides: ResourceOverrides = {}) {
  return {
    resource_type: "session",
    id: 7,
    label: "F1 Weekend",
    owner: "kyros",
    owner_missing: false,
    viewer_count: 0,
    system: false,
    ...overrides,
  }
}

function accessView() {
  return { resource_type: "session", id: 7, owner: "kyros", owner_missing: false, grants: [] }
}

function renderAdmin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<AdministrationSection />, { wrapper: Wrapper })
}

function resourcePanel(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: "Resource access" })
  const section = heading.closest("section")
  if (section === null) throw new Error("Resource access panel missing")
  return section
}

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchClients.mockResolvedValue([])
  api.fetchRegistrationRequests.mockResolvedValue([])
  api.fetchUsers.mockResolvedValue(USERS)
  api.fetchAdminResources.mockResolvedValue({ items: [], total: 0 })
  api.fetchResourceAccess.mockResolvedValue(accessView())
  api.setResourceOwner.mockImplementation((_type: string, _id: number, username: string) =>
    Promise.resolve({ resource_type: "session", id: 7, owner: username }),
  )
  api.setResourceGrants.mockResolvedValue(accessView())
  api.revokeResourceUser.mockResolvedValue(accessView())
})

describe("ResourceAccessSection", () => {
  it("shows a loading skeleton while resources load", async () => {
    api.fetchAdminResources.mockReturnValue(new Promise(() => undefined))

    renderAdmin()

    await waitFor(() => expect(resourcePanel().querySelector('[aria-label="Loading"]')).not.toBeNull())
  })

  it("shows an empty state when no resources match", async () => {
    renderAdmin()

    expect(await within(resourcePanel()).findByText("No resources")).toBeTruthy()
  })

  it("shows an error panel when the resource list fails", async () => {
    api.fetchAdminResources.mockRejectedValue(new Error("boom"))

    renderAdmin()

    expect(await within(resourcePanel()).findByText("Could not load resources")).toBeTruthy()
  })

  it("renders a page with label, type, owner and viewer count", async () => {
    api.fetchAdminResources.mockResolvedValue({
      items: [resource({ viewer_count: 2 }), resource({ resource_type: "engine", id: 1, label: "Streamlink", owner: "", system: true })],
      total: 2,
    })

    renderAdmin()

    const table = await within(resourcePanel()).findByRole("table")
    expect(within(table).getByText("F1 Weekend")).toBeTruthy()
    expect(within(table).getByText("Session")).toBeTruthy()
    expect(within(table).getByText("kyros")).toBeTruthy()
    expect(within(table).getByText("2")).toBeTruthy()
  })

  it("exposes no edit affordance for system rows", async () => {
    api.fetchAdminResources.mockResolvedValue({
      items: [
        resource({ resource_type: "session", id: 7, label: "F1 Weekend" }),
        resource({ resource_type: "engine", id: 1, label: "Streamlink", owner: "", system: true }),
      ],
      total: 2,
    })

    renderAdmin()

    await within(resourcePanel()).findByText("Streamlink")
    expect(screen.queryByRole("button", { name: "Manage access for Streamlink" })).toBeNull()
    expect(screen.getByRole("button", { name: "Manage access for F1 Weekend" })).toBeTruthy()
    expect(within(resourcePanel()).getByText("System")).toBeTruthy()
  })

  it("changes the owner through the dialog", async () => {
    api.fetchAdminResources.mockResolvedValue({ items: [resource()], total: 1 })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Manage access for F1 Weekend" }))
    fireEvent.click(await screen.findByRole("button", { name: "Change" }))
    fireEvent.click(within(screen.getByTestId("access-catalog")).getByRole("button", { name: /Alice/ }))
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.setResourceOwner).toHaveBeenCalledWith("session", 7, "alice"))
  })

  it("adds a viewer through the dialog", async () => {
    api.fetchAdminResources.mockResolvedValue({ items: [resource()], total: 1 })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Manage access for F1 Weekend" }))
    fireEvent.click(within(await screen.findByTestId("access-catalog")).getByRole("button", { name: /Alice/ }))
    fireEvent.click(
      within(screen.getByRole("group", { name: "Capabilities for the selected users" })).getByRole(
        "button",
        { name: "View access" },
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.setResourceGrants).toHaveBeenCalledWith("session", 7, "alice", ["VIEW"]))
  })

  it("removes a viewer through the dialog", async () => {
    api.fetchAdminResources.mockResolvedValue({ items: [resource({ viewer_count: 1 })], total: 1 })
    api.fetchResourceAccess.mockResolvedValue({
      resource_type: "session",
      id: 7,
      owner: "kyros",
      owner_missing: false,
      grants: [{ username: "alice", capabilities: ["VIEW"] }],
    })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Manage access for F1 Weekend" }))
    fireEvent.click(within(await screen.findByTestId("access-catalog")).getByRole("button", { name: /Alice/ }))
    fireEvent.click(
      within(screen.getByRole("group", { name: "Capabilities for the selected users" })).getByRole(
        "button",
        { name: "View access" },
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.revokeResourceUser).toHaveBeenCalledWith("session", 7, "alice"))
  })
})
