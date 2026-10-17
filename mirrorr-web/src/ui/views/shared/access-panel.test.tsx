import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CAPABILITIES, type Capability, type ResourceType } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { AccessPanel } from "./access-panel"

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchGroups: vi.fn(),
  fetchResourceAccess: vi.fn(),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}))

// The panel reaches the wire through the planner, which reads this module directly.
const endpoints = vi.hoisted(() => ({
  setResourceOwner: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
  setGroupGrants: vi.fn(),
  revokeGroupGrants: vi.fn(),
}))

vi.mock("@/api", () => api)
vi.mock("@/api/endpoints/access", () => endpoints)

const USERS: readonly User[] = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
  { id: 3, username: "bob", role: "user", display_name: "Bob" },
  { id: 4, username: "carol", role: "user", display_name: "Carol" },
]

const GROUPS = [
  { id: 1, name: "everyone", display_name: "Everyone", system: true, member_count: 0, members: [] },
  { id: 2, name: "editors", display_name: "Editors", system: false, member_count: 3, members: [] },
  { id: 3, name: "ops", display_name: "Operations", system: false, member_count: 1, members: [] },
]

interface GrantInput {
  readonly owner?: string
  readonly grants?: Partial<Record<Capability, readonly string[]>>
}

function accessView({ owner = "kyros", grants = {} }: GrantInput = {}) {
  return {
    resource_type: "session",
    id: 1,
    owner,
    owner_missing: false,
    grants: CAPABILITIES.flatMap((capability) =>
      (grants[capability] ?? []).map((username) => ({ username, capabilities: [capability] })),
    ),
    owner_groups: [] as { id: number; name: string; display_name: string; system: boolean }[],
    group_grants: [] as unknown[],
  }
}

function renderPanel(resourceType: ResourceType = "session") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <AccessPanel resourceType={resourceType} id={1} label="F1 Weekend" onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

/** The search field only exists once the access read has landed. */
async function loaded(): Promise<void> {
  await screen.findByLabelText("Search users and groups")
}

function catalog(): HTMLElement {
  return screen.getByTestId("access-catalog")
}

function setGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Capabilities for the selected users and groups" })
}

/** A capability chip of the chip row (no count — its name is exactly the label). */
function setChip(label: string): HTMLButtonElement {
  return within(setGroup()).getByRole("button", { name: label }) as HTMLButtonElement
}

function card(name: string): HTMLElement {
  return within(catalog()).getByRole("option", { name: new RegExp(name) })
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement
}

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchUsers.mockResolvedValue(USERS)
  api.fetchGroups.mockResolvedValue({ items: GROUPS, total: GROUPS.length })
  api.fetchResourceAccess.mockResolvedValue(accessView())
})

describe("AccessPanel", () => {
  it("shows the header, the owner row and one users-and-groups catalog that excludes the owner", async () => {
    renderPanel()

    expect(await screen.findByText("Access · F1 Weekend")).toBeTruthy()
    expect(screen.getByText("Session · #1")).toBeTruthy()
    await loaded()

    expect(screen.getByText("Kyros")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy()
    expect(card("Alice")).toBeTruthy()
    expect(card("Bob")).toBeTruthy()
    // One list carries both kinds; the owner is left out of the grant list.
    expect(card("Editors")).toBeTruthy()
    expect(within(catalog()).queryByRole("option", { name: /Kyros/ })).toBeNull()
    // The old per-section prose is gone.
    expect(screen.queryByText("Only the owner can see this item.")).toBeNull()
  })

  it("shows the capability chip row in the frozen capability order", async () => {
    renderPanel()
    await loaded()

    expect([...CAPABILITIES]).toEqual(["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"])
    const labels = ["View access", "Operate", "Edit", "Delete", "Share"]
    for (const label of labels) expect(setChip(label)).toBeTruthy()
    // A session has no export route, so the type filter does not offer EXPORT.
    expect(within(setGroup()).queryByRole("button", { name: "Export" })).toBeNull()
  })

  it("filters the catalog by username and display name as you type", async () => {
    renderPanel()
    await loaded()

    expect(card("Bob")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Search users and groups"), { target: { value: "ali" } })

    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("option", { name: /Bob/ })).toBeNull()
    expect(within(catalog()).queryByRole("option", { name: /Carol/ })).toBeNull()
  })

  it("shows an empty catalog state when nothing matches", async () => {
    renderPanel()
    await loaded()

    fireEvent.change(screen.getByLabelText("Search users and groups"), { target: { value: "zzzznobody" } })

    expect(screen.getByText("No users or groups match.")).toBeTruthy()
  })

  it("offers only the capabilities a recording enforces", async () => {
    renderPanel("recording")
    await loaded()

    for (const label of ["View access", "Delete", "Share"]) expect(setChip(label)).toBeTruthy()
    // A recording has no control, edit or export route.
    expect(within(setGroup()).queryByRole("button", { name: "Operate" })).toBeNull()
    expect(within(setGroup()).queryByRole("button", { name: "Edit" })).toBeNull()
  })

  it("keeps an inapplicable existing grant visible and removable", async () => {
    api.fetchResourceAccess.mockResolvedValue(accessView({ grants: { VIEW: ["bob"], OPERATE: ["bob"] } }))
    renderPanel("recording")
    await loaded()

    // OPERATE is not offered for recordings, but Bob holds it — the chip must
    // still exist so the pre-existing grant can be removed.
    const retired = setChip("Operate")
    expect(retired.getAttribute("title")).toBeTruthy()

    fireEvent.click(card("Bob"))
    fireEvent.click(retired)
    fireEvent.click(applyButton())

    await waitFor(() =>
      expect(endpoints.setResourceGrants).toHaveBeenCalledWith("recording", 1, "bob", ["VIEW"]),
    )
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
  })

  it("keeps Apply disabled until the draft is dirty", async () => {
    renderPanel()
    await loaded()
    expect(applyButton().disabled).toBe(true)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("View access"))

    expect(applyButton().disabled).toBe(false)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("grants VIEW through the lower chip row on Apply and emits nothing before", async () => {
    renderPanel()
    await loaded()

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("View access"))

    expect(card("Bob").getAttribute("aria-selected")).toBe("true")
    // Drafting alone must reach no wire — a control that only looks like it grants fails here.
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
    expect(endpoints.setResourceOwner).not.toHaveBeenCalled()

    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(1))
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "bob", ["VIEW"])
  })

  it("implies VIEW when another capability is granted", async () => {
    renderPanel()
    await loaded()

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))
    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(1))
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "bob", ["VIEW", "OPERATE"])
  })

  it("revokes a user's last capability outright through DELETE", async () => {
    api.fetchResourceAccess.mockResolvedValue(accessView({ grants: { VIEW: ["bob"] } }))
    renderPanel()
    await loaded()

    fireEvent.click(card("Bob"))
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(setChip("View access"))
    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.revokeResourceUser).toHaveBeenCalledTimes(1))
    expect(endpoints.revokeResourceUser).toHaveBeenCalledWith("session", 1, "bob")
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()
  })

  it("warns and clears every capability when VIEW is unticked", async () => {
    api.fetchResourceAccess.mockResolvedValue(accessView({ grants: { VIEW: ["bob"], OPERATE: ["bob"] } }))
    renderPanel()
    await loaded()

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("View access"))

    expect(screen.getByText("Clearing View access also clears every other capability.")).toBeTruthy()
    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.revokeResourceUser).toHaveBeenCalledWith("session", 1, "bob"))
  })

  it("marks the chip mixed when only some selected principals hold it", async () => {
    api.fetchResourceAccess.mockResolvedValue(accessView({ grants: { VIEW: ["bob"], OPERATE: ["bob"] } }))
    renderPanel()
    await loaded()

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("mixed")
    // Three users and three groups — the one list takes both.
    expect(screen.getByText("6 selected")).toBeTruthy()

    fireEvent.click(setChip("Operate"))
    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(applyButton())
    // Alice and Carol gain VIEW + OPERATE; Bob already holds both, so no wire for him.
    await waitFor(() => expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(4))
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "alice", ["VIEW", "OPERATE"])
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "carol", ["VIEW", "OPERATE"])
    expect(endpoints.setResourceGrants).not.toHaveBeenCalledWith("session", 1, "bob", expect.anything())
    // The three groups ride the same selection, each through its own replace-set.
    await waitFor(() => expect(endpoints.setGroupGrants).toHaveBeenCalledTimes(3))
    expect(endpoints.setGroupGrants).toHaveBeenCalledWith("session", 1, 2, ["VIEW", "OPERATE"])
  })

  it("selects every shown card and clears the selection", async () => {
    renderPanel()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(within(catalog()).getAllByRole("option", { selected: true })).toHaveLength(6)

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(within(catalog()).queryAllByRole("option", { selected: true })).toHaveLength(0)
    expect((setChip("Operate") as HTMLButtonElement).disabled).toBe(true)
  })

  it("transfers ownership from the owner picker", async () => {
    renderPanel()
    await loaded()

    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByText("Pick the new owner")).toBeTruthy()
    // A transfer is a user pick, and it hides the grant chip row.
    expect(screen.getByRole("listbox", { name: "Users" })).toBeTruthy()
    expect(screen.queryByRole("group", { name: "Capabilities for the selected users and groups" })).toBeNull()

    fireEvent.click(card("Alice"))
    expect(card("Alice").getAttribute("aria-selected")).toBe("true")

    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceOwner).toHaveBeenCalledTimes(1))
    expect(endpoints.setResourceOwner).toHaveBeenCalledWith("session", 1, "alice")
  })

  it("wears the granted-variant highlight on the selected cards alone", async () => {
    renderPanel()
    await loaded()

    const bob = card("Bob")
    const carol = card("Carol")
    expect(bob.className).not.toContain("data-[granted=true]:")

    fireEvent.click(bob)

    expect(bob.getAttribute("data-granted")).toBe("true")
    expect(bob.className).toContain("data-[granted=true]:border-brand")
    expect(bob.className).toContain("data-[granted=true]:bg-[var(--accent-dim)]")
    // The old spelling lost the cascade to `border-line`/`bg-surface-2` (equal
    // specificity, later in the sheet), so the highlight rendered dead.
    expect(bob.className).not.toContain("[background-color:var(--accent-dim)]")
    expect(carol.className).not.toContain("data-[granted=true]:")
  })

  it("caps the catalog and pins the dirty indicator and Apply outside its scroll region", async () => {
    renderPanel()
    await loaded()

    const dialog = screen.getByRole("dialog")
    const region = catalog()
    // Guard against a vacuous pass: the catalog really is the scroll region.
    expect(region.className).toContain("overflow-y-auto")
    expect(region.className).toContain("max-h-[calc(100dvh-520px)]")
    expect(region).not.toBe(dialog)

    const indicator = screen.getByText("Up to date")
    const apply = applyButton()

    expect(region.contains(indicator)).toBe(false)
    expect(region.contains(apply)).toBe(false)
    expect(dialog.contains(indicator)).toBe(true)
    expect(dialog.contains(apply)).toBe(true)
  })

  it("lists the groups the server offers beside the users", async () => {
    renderPanel()
    await loaded()

    expect(card("Editors")).toBeTruthy()
    expect(screen.getByText("3 members")).toBeTruthy()
    expect(screen.getByText("every account, including future ones")).toBeTruthy()
    expect(within(catalog()).getByText("@bob")).toBeTruthy()
  })
})
