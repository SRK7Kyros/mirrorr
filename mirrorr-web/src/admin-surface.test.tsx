import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { AdministrationSection } from "./admin-surface"
import type { OwnerTarget } from "@/api/endpoints/access"

const api = vi.hoisted(() => ({
  approveRegistrationRequest: vi.fn(),
  createClient: vi.fn(),
  createGroup: vi.fn(),
  createUser: vi.fn(),
  deleteClient: vi.fn(),
  deleteGroup: vi.fn(),
  deleteUser: vi.fn(),
  denyRegistrationRequest: vi.fn(),
  fetchClients: vi.fn(),
  fetchGroups: vi.fn(),
  fetchRegistrationRequests: vi.fn(),
  fetchUsers: vi.fn(),
  formatRelativeTime: vi.fn((value: string) => value),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
  fetchAdminResources: vi.fn(),
  fetchResourceAccess: vi.fn(),
  setGroupMembers: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
  updateGroup: vi.fn(),
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
  readonly owner_groups?: readonly string[]
  readonly grant_groups?: readonly string[]
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
    owner_groups: [],
    grant_groups: [],
    ...overrides,
  }
}

function groupRow(overrides: Partial<ReturnType<typeof groupBase>> = {}) {
  return { ...groupBase(), ...overrides }
}

function groupBase() {
  return {
    id: 2,
    name: "editors",
    display_name: "Editors",
    system: false,
    member_count: 3,
    members: ["kyros", "alice", "bob"] as readonly string[],
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

function groupsPanel(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: "Groups" })
  const section = heading.closest("section")
  if (section === null) throw new Error("Groups panel missing")
  return section
}

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchClients.mockResolvedValue([])
  api.fetchGroups.mockResolvedValue({ items: [], total: 0 })
  api.fetchRegistrationRequests.mockResolvedValue([])
  api.fetchUsers.mockResolvedValue(USERS)
  api.fetchAdminResources.mockResolvedValue({ items: [], total: 0 })
  api.fetchResourceAccess.mockResolvedValue(accessView())
  api.setResourceOwner.mockImplementation((_type: string, _id: number, target: OwnerTarget) =>
    Promise.resolve({
      resource_type: "session",
      id: 7,
      owner: "username" in target ? target.username : "",
      owner_group_id: "group_id" in target ? target.group_id : null,
    }),
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
    expect(within(table).getByText("2 viewers")).toBeTruthy()
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
    fireEvent.click(await screen.findByRole("button", { name: "Change the owner" }))
    fireEvent.click(within(screen.getByTestId("access-catalog")).getByRole("option", { name: /Alice/ }))
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.setResourceOwner).toHaveBeenCalledWith("session", 7, { username: "alice" }))
  })

  it("crowns a group through the dialog", async () => {
    api.fetchAdminResources.mockResolvedValue({ items: [resource()], total: 1 })
    api.fetchGroups.mockResolvedValue({
      items: [{ id: 2, name: "editors", display_name: "Editors", system: false, member_count: 3, members: [] }],
      total: 1,
    })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Manage access for F1 Weekend" }))
    fireEvent.click(await screen.findByRole("button", { name: "Change the owner" }))
    fireEvent.click(within(screen.getByTestId("access-catalog")).getByRole("option", { name: /Editors/ }))
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.setResourceOwner).toHaveBeenCalledWith("session", 7, { group_id: 2 }))
  })

  it("adds a viewer through the dialog", async () => {
    api.fetchAdminResources.mockResolvedValue({ items: [resource()], total: 1 })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Manage access for F1 Weekend" }))
    fireEvent.click(within(await screen.findByTestId("access-catalog")).getByRole("option", { name: /Alice/ }))
    fireEvent.click(
      within(screen.getByRole("group", { name: "Capabilities for the selected users and groups" })).getByRole(
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
    fireEvent.click(within(await screen.findByTestId("access-catalog")).getByRole("option", { name: /Alice/ }))
    fireEvent.click(
      within(screen.getByRole("group", { name: "Capabilities for the selected users and groups" })).getByRole(
        "button",
        { name: "View access" },
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }))

    await waitFor(() => expect(api.revokeResourceUser).toHaveBeenCalledWith("session", 7, "alice"))
  })
})

describe("GroupsSection", () => {
  it("renders groups with a member count and a read-only everyone row", async () => {
    api.fetchGroups.mockResolvedValue({
      items: [
        groupRow(),
        groupRow({ id: 1, name: "everyone", display_name: "Everyone", system: true, member_count: 0, members: [] }),
      ],
      total: 2,
    })

    renderAdmin()

    const table = await within(groupsPanel()).findByRole("table")
    expect(within(table).getByText("Editors")).toBeTruthy()
    expect(within(table).getByText("@editors")).toBeTruthy()
    expect(within(table).getByText("3")).toBeTruthy()
    expect(within(table).getByText("@everyone")).toBeTruthy()
    expect(within(table).getByText("System")).toBeTruthy()
    expect(
      within(table).getByText("Every account, including future ones — membership is implicit."),
    ).toBeTruthy()
    expect(within(table).getAllByRole("button", { name: "Members" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Edit everyone" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete everyone" })).toBeNull()
  })

  it("creates a group from the dialog", async () => {
    api.createGroup.mockResolvedValue(groupRow({ member_count: 0, members: [] }))

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Add group" }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "editors" } })
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Editors" } })
    fireEvent.click(screen.getByRole("button", { name: "Create group" }))

    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("editors", "Editors"))
  })

  it("renames a group through the dialog", async () => {
    api.fetchGroups.mockResolvedValue({ items: [groupRow()], total: 1 })
    api.updateGroup.mockResolvedValue(groupRow({ display_name: "Editors!" }))

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Edit editors" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Display name"), { target: { value: "Editors!" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(api.updateGroup).toHaveBeenCalledWith(2, { name: "editors", display_name: "Editors!" }),
    )
  })

  it("deletes a group after the confirmation", async () => {
    api.fetchGroups.mockResolvedValue({ items: [groupRow()], total: 1 })
    api.deleteGroup.mockResolvedValue({ status: "deleted", id: 2 })

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Delete editors" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Delete group")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(api.deleteGroup).toHaveBeenCalledWith(2))
  })

  it("applies a member set through the members dialog", async () => {
    api.fetchGroups.mockResolvedValue({ items: [groupRow({ member_count: 0, members: [] })], total: 1 })
    api.setGroupMembers.mockResolvedValue(groupRow({ member_count: 2, members: ["kyros", "alice"] }))

    renderAdmin()

    fireEvent.click(await screen.findByRole("button", { name: "Members" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Select all" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Save members" }))

    await waitFor(() => expect(api.setGroupMembers).toHaveBeenCalledWith(2, ["kyros", "alice"]))
  })
})
