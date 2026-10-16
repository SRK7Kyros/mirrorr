import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import {
  applyPlans,
  emptyGrants,
  planItem,
  type AccessTarget,
  type ItemAccess,
} from "@/api/domain/access-plan"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { holdsCapability, ResourceAccessFields } from "./resource-access"

// The planner fans out over the endpoint module (importing the barrel from a
// domain module would close a cycle), so it needs its own double. Every test
// that reaches the wire asserts on these calls, not just on the rendered state.
const endpoints = vi.hoisted(() => ({
  setResourceOwner: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
}))
vi.mock("@/api/endpoints/access", () => endpoints)

const USERS: readonly User[] = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
  { id: 3, username: "bob", role: "user", display_name: "Bob" },
  { id: 4, username: "carol", role: "user", display_name: "Carol" },
]

const USERNAMES = USERS.map((user) => user.username)

/** A full grant record — every capability present, exactly as `emptyGrants` guarantees. */
function access(
  overrides: Partial<Record<Capability, readonly string[]>> & {
    readonly owner?: string
    readonly ownerMissing?: boolean
  } = {},
): ItemAccess {
  const { owner = "kyros", ownerMissing = false, ...grants } = overrides
  return { owner, ownerMissing, grants: { ...emptyGrants(), ...grants } }
}

function row(itemAccess: ItemAccess) {
  return { resourceType: "session", id: 1, label: "F1 Weekend", access: itemAccess }
}

function catalog(): HTMLElement {
  return screen.getByTestId("access-catalog")
}

function filterGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Filter by capability" })
}

function setGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Capabilities for the selected users" })
}

function filterChip(label: string): HTMLButtonElement {
  return within(filterGroup()).getByRole("button", { name: new RegExp(`^${label}`) }) as HTMLButtonElement
}

function setChip(label: string): HTMLButtonElement {
  return within(setGroup()).getByRole("button", { name: label }) as HTMLButtonElement
}

function card(name: string): HTMLButtonElement {
  return within(catalog()).getByRole("button", { name: new RegExp(name) }) as HTMLButtonElement
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement
}

describe("holdsCapability", () => {
  it("reads VIEW from any held capability but the rest literally", () => {
    const grants = { ...emptyGrants(), OPERATE: ["bob"] }
    expect(holdsCapability(grants, "VIEW", "bob")).toBe(true)
    expect(holdsCapability(grants, "OPERATE", "bob")).toBe(true)
    expect(holdsCapability(grants, "EDIT", "bob")).toBe(false)
    expect(holdsCapability(grants, "VIEW", "alice")).toBe(false)
  })
})

describe("ResourceAccessFields", () => {
  it("renders the owner row, one catalog, both chip rows and no per-section prose", () => {
    render(<ResourceAccessFields access={access()} users={USERS} onApply={vi.fn()} />)

    expect([...CAPABILITIES]).toEqual(["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"])
    expect(screen.getByText("Kyros")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy()
    expect(catalog()).toBeTruthy()
    const labels = ["View access", "Operate", "Edit", "Delete", "Share", "Export"]
    for (const label of labels) {
      expect(filterChip(label)).toBeTruthy()
      expect(setChip(label)).toBeTruthy()
    }
    expect(screen.queryByText("Only the owner can see this item.")).toBeNull()
    expect(screen.getByText("Up to date")).toBeTruthy()
  })

  it("keeps Apply disabled until the draft is dirty", () => {
    render(<ResourceAccessFields access={access()} users={USERS} onApply={vi.fn()} />)
    expect(applyButton().disabled).toBe(true)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))

    expect(applyButton().disabled).toBe(false)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("transfers ownership from the owner picker and hides the chip rows meanwhile", () => {
    const onApply = vi.fn()
    render(<ResourceAccessFields access={access()} users={USERS} onApply={onApply} />)

    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByText("Pick the new owner")).toBeTruthy()
    expect(screen.queryByRole("group", { name: "Filter by capability" })).toBeNull()

    fireEvent.click(card("Carol"))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.owner).toBe("carol")
  })

  it("implies VIEW and issues one request per resulting capability", async () => {
    const base = access()
    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))

    // Drafting alone reaches no wire — a control that only looks like it grants fails here.
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()

    fireEvent.click(applyButton())
    expect(onApply).toHaveBeenCalledTimes(1)
    const target = onApply.mock.calls[0][0] as AccessTarget

    const plan = planItem(row(base), target, USERNAMES)
    expect(plan.ops).toEqual([
      { kind: "grant", capability: "VIEW", username: "bob" },
      { kind: "grant", capability: "OPERATE", username: "bob" },
    ])

    await applyPlans([plan])
    expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(2)
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(1, "session", 1, "bob", ["VIEW", "OPERATE"])
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(2, "session", 1, "bob", ["VIEW", "OPERATE"])
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
  })

  it("clears every capability for the user when VIEW is unticked", async () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"], EDIT: ["bob"] })
    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    fireEvent.click(card("Bob"))
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(setChip("View access"))
    expect(screen.getByText("Clearing View access also clears every other capability.")).toBeTruthy()

    fireEvent.click(applyButton())
    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.VIEW).toEqual([])
    expect(target.grants?.OPERATE).toEqual([])
    expect(target.grants?.EDIT).toEqual([])

    const plan = planItem(row(base), target, USERNAMES)
    expect(plan.ops).toEqual([
      { kind: "revoke", capability: "VIEW", username: "bob" },
      { kind: "revoke", capability: "OPERATE", username: "bob" },
      { kind: "revoke", capability: "EDIT", username: "bob" },
    ])

    await applyPlans([plan])
    expect(endpoints.revokeResourceUser).toHaveBeenCalledWith("session", 1, "bob")
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()
  })

  it("filters the catalog to a capability's holders with the upper chips", () => {
    render(<ResourceAccessFields access={access({ VIEW: ["bob"] })} users={USERS} onApply={vi.fn()} />)

    expect(card("Alice")).toBeTruthy()
    fireEvent.click(filterChip("View access"))

    expect(card("Bob")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Alice/ })).toBeNull()

    fireEvent.click(filterChip("View access"))
    expect(card("Alice")).toBeTruthy()
  })

  it("shows a partial lower chip when only some selected users hold the capability", () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] })
    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("mixed")
    fireEvent.click(setChip("Operate"))
    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(applyButton())
    const target = onApply.mock.calls[0][0] as AccessTarget
    expect([...(target.grants?.OPERATE ?? [])].sort()).toEqual(["alice", "bob", "carol"])
  })

  it("selects every shown card and clears the selection", () => {
    render(<ResourceAccessFields access={access()} users={USERS} onApply={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(within(catalog()).getAllByRole("button", { pressed: true })).toHaveLength(3)

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(within(catalog()).queryAllByRole("button", { pressed: true })).toHaveLength(0)
  })

  it("reloads on a changed access prop and preserves the draft on an unchanged one", () => {
    const base = access()
    const { rerender } = render(
      <ResourceAccessFields access={base} users={USERS} onApply={vi.fn()} />,
    )

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Same value → same signature → the in-flight edit survives.
    rerender(<ResourceAccessFields access={base} users={USERS} onApply={vi.fn()} />)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Different value → the draft reloads from the server state.
    rerender(<ResourceAccessFields access={access({ VIEW: ["alice"] })} users={USERS} onApply={vi.fn()} />)
    expect(screen.getByText("Up to date")).toBeTruthy()
    expect(applyButton().disabled).toBe(true)
    // Bob is no longer visible in the refiltered catalog once VIEW is filtered.
    fireEvent.click(filterChip("View access"))
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()
  })

  it("disables Apply, the cards and the chip rows while busy", () => {
    render(<ResourceAccessFields access={access({ VIEW: ["bob"] })} users={USERS} busy onApply={vi.fn()} />)

    // The Spinner contributes "Loading" to the button's accessible name, so
    // locate the Apply control by its label span instead of the composed name.
    const applyControl = screen.getByText("Apply changes").closest("button")
    expect(applyControl).not.toBeNull()
    expect((applyControl as HTMLButtonElement).disabled).toBe(true)
    expect(filterChip("Operate").disabled).toBe(true)
    expect(setChip("Operate").disabled).toBe(true)
    expect(card("Bob").disabled).toBe(true)
  })

  it("carries all six capability keys and grants onto an otherwise-empty capability", () => {
    const base = access()
    expect(Object.keys(base.grants).sort()).toEqual([...CAPABILITIES].sort())

    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Export"))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.EXPORT).toEqual(["bob"])
    expect(target.grants?.VIEW).toEqual(["bob"])
    for (const capability of CAPABILITIES) {
      if (capability !== "EXPORT" && capability !== "VIEW") expect(target.grants?.[capability]).toEqual([])
    }
  })
})
