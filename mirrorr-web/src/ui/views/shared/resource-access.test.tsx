import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import {
  applyPlans,
  emptyGrants,
  emptyGroupGrants,
  planItem,
  type AccessTarget,
  type ItemAccess,
} from "@/api/domain/access-plan"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  type AccessGroup,
  type GroupDraftTarget,
  holdsCapability,
  ResourceAccessFields,
} from "./resource-access"

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

const GROUPS: readonly AccessGroup[] = [
  { id: 1, name: "everyone", display_name: "Everyone", system: true },
  { id: 2, name: "editors", display_name: "Editors", system: false, member_count: 3 },
  { id: 3, name: "ops", display_name: "Operations", system: false, member_count: 1 },
]

function switchToGroups(): void {
  const principal = screen.getByRole("group", { name: "Principal" })
  fireEvent.click(within(principal).getByRole("button", { name: "Groups" }))
}

/** A full grant record — every capability present, exactly as `emptyGrants` guarantees. */
function access(
  overrides: Partial<Record<Capability, readonly string[]>> & {
    readonly owner?: string
    readonly ownerMissing?: boolean
    readonly groupGrants?: Partial<Record<Capability, readonly number[]>>
    readonly ownerGroups?: readonly number[]
  } = {},
): ItemAccess {
  const { owner = "kyros", ownerMissing = false, groupGrants = {}, ownerGroups = [], ...grants } = overrides
  return {
    owner,
    ownerMissing,
    grants: { ...emptyGrants(), ...grants },
    groupGrants: { ...emptyGroupGrants(), ...groupGrants },
    ownerGroups,
  }
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
    render(<ResourceAccessFields resourceType="session" access={access()} users={USERS} groups={GROUPS} onApply={vi.fn()} />)

    expect([...CAPABILITIES]).toEqual(["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"])
    expect(screen.getByText("Kyros")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy()
    expect(catalog()).toBeTruthy()
    const labels = ["View access", "Operate", "Edit", "Delete", "Share"]
    for (const label of labels) {
      expect(filterChip(label)).toBeTruthy()
      expect(setChip(label)).toBeTruthy()
    }
    // A session has no export route, so the type filter does not offer EXPORT.
    expect(within(filterGroup()).queryByRole("button", { name: /^Export/ })).toBeNull()
    expect(within(setGroup()).queryByRole("button", { name: "Export" })).toBeNull()
    expect(screen.queryByText("Only the owner can see this item.")).toBeNull()
    expect(screen.getByText("Up to date")).toBeTruthy()
  })

  it("keeps Apply disabled until the draft is dirty", () => {
    render(<ResourceAccessFields resourceType="session" access={access()} users={USERS} groups={GROUPS} onApply={vi.fn()} />)
    expect(applyButton().disabled).toBe(true)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))

    expect(applyButton().disabled).toBe(false)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("transfers ownership from the owner picker and hides the chip rows meanwhile", () => {
    const onApply = vi.fn()
    render(<ResourceAccessFields resourceType="session" access={access()} users={USERS} groups={GROUPS} onApply={onApply} />)

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
    render(<ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={onApply} />)

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
    render(<ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={onApply} />)

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
    render(<ResourceAccessFields resourceType="session" access={access({ VIEW: ["bob"] })} users={USERS} groups={GROUPS} onApply={vi.fn()} />)

    expect(card("Alice")).toBeTruthy()
    fireEvent.click(filterChip("View access"))

    expect(card("Bob")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Alice/ })).toBeNull()

    // Red keeps the users who do *not* hold it — for VIEW, the ones who hold
    // nothing at all, which is who a bulk grant is for.
    fireEvent.click(filterChip("View access"))
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()

    fireEvent.click(filterChip("View access"))
    expect(card("Bob")).toBeTruthy()
  })

  it("shows a partial lower chip when only some selected users hold the capability", () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] })
    const onApply = vi.fn()
    render(<ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={onApply} />)

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
    render(<ResourceAccessFields resourceType="session" access={access()} users={USERS} groups={GROUPS} onApply={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(within(catalog()).getAllByRole("button", { pressed: true })).toHaveLength(3)

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(within(catalog()).queryAllByRole("button", { pressed: true })).toHaveLength(0)
  })

  it("reloads on a changed access prop and preserves the draft on an unchanged one", () => {
    const base = access()
    const { rerender } = render(
      <ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={vi.fn()} />,
    )

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Operate"))
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Same value → same signature → the in-flight edit survives.
    rerender(<ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={vi.fn()} />)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Different value → the draft reloads from the server state.
    rerender(<ResourceAccessFields resourceType="session" access={access({ VIEW: ["alice"] })} users={USERS} groups={GROUPS} onApply={vi.fn()} />)
    expect(screen.getByText("Up to date")).toBeTruthy()
    expect(applyButton().disabled).toBe(true)
    // Bob is no longer visible in the refiltered catalog once VIEW is filtered.
    fireEvent.click(filterChip("View access"))
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()
  })

  it("disables Apply, the cards and the chip rows while busy", () => {
    render(<ResourceAccessFields resourceType="session" access={access({ VIEW: ["bob"] })} users={USERS} busy groups={GROUPS} onApply={vi.fn()} />)

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
    render(<ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={onApply} />)

    fireEvent.click(card("Bob"))
    fireEvent.click(setChip("Delete"))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.DELETE).toEqual(["bob"])
    expect(target.grants?.VIEW).toEqual(["bob"])
    for (const capability of CAPABILITIES) {
      if (capability !== "DELETE" && capability !== "VIEW") expect(target.grants?.[capability]).toEqual([])
    }
  })

  it("narrows to the users who hold every green chip", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ OPERATE: ["bob"], EDIT: ["carol"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    fireEvent.click(filterChip("Operate"))
    fireEvent.click(filterChip("Edit"))

    // Bob holds OPERATE only and Carol EDIT only, so demanding both matches
    // nobody: the chips narrow rather than widen.
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(0)

    fireEvent.click(filterChip("Edit"))
    expect(card("Bob")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Carol/ })).toBeNull()
  })

  it("keeps All active only while no capability chip is selected", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ VIEW: ["bob"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    const all = within(filterGroup()).getByRole("button", { name: "All" })
    expect(all.getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(filterChip("View access"))
    expect(all.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(all)
    expect(all.getAttribute("aria-pressed")).toBe("true")
    expect(card("Alice")).toBeTruthy()
  })

  it("offers only the capabilities the item type enforces", () => {
    render(
      <ResourceAccessFields resourceType="autorun" access={access()} users={USERS} groups={GROUPS} onApply={vi.fn()} />,
    )

    for (const label of ["View access", "Edit", "Delete", "Share", "Export"]) {
      expect(setChip(label)).toBeTruthy()
    }
    // An autorun has no control route, so OPERATE would be an inert control.
    expect(within(filterGroup()).queryByRole("button", { name: /^Operate/ })).toBeNull()
    expect(within(setGroup()).queryByRole("button", { name: "Operate" })).toBeNull()
  })

  it("keeps a granted capability the type no longer offers clearable", () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] })
    const onApply = vi.fn()
    render(
      <ResourceAccessFields resourceType="autorun" access={base} users={USERS} groups={GROUPS} onApply={onApply} />,
    )

    // OPERATE is not offered for autoruns, but Bob holds it — the chip must
    // still exist so the pre-existing grant can be removed.
    const retired = setChip("Operate")
    expect(retired.getAttribute("title")).toBeTruthy()

    fireEvent.click(card("Bob"))
    fireEvent.click(retired)
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.OPERATE).toEqual([])
    expect(target.grants?.VIEW).toEqual(["bob"])
  })

  it("cycles a capability chip through include, exclude and off", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ OPERATE: ["alice"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    const operate = filterChip("Operate")
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(3)

    fireEvent.click(operate)
    expect(operate.getAttribute("aria-pressed")).toBe("true")
    expect(operate.className).toContain("border-brand")
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()

    fireEvent.click(operate)
    expect(operate.getAttribute("aria-pressed")).toBe("mixed")
    expect(operate.className).toContain("border-danger")
    expect(within(catalog()).queryByRole("button", { name: /Alice/ })).toBeNull()
    expect(card("Bob")).toBeTruthy()

    // Select all takes the excluded half, so the lower row can grant a
    // capability to exactly the users who lack it.
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(card("Bob").getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(operate)
    expect(operate.getAttribute("aria-pressed")).toBe("false")
    expect(operate.className).toContain("border-line")
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(3)
  })

  it("ANDs the green chips and subtracts the red ones", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ OPERATE: ["alice"], EDIT: ["bob"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    fireEvent.click(filterChip("Operate"))
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()

    // A second green chip narrows instead of widening: nobody holds both.
    fireEvent.click(filterChip("Edit"))
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByText("No users match.")).toBeTruthy()

    // Flipping Edit to red brings Alice back: holds OPERATE, not EDIT.
    fireEvent.click(filterChip("Edit"))
    expect(filterChip("Edit").getAttribute("aria-pressed")).toBe("mixed")
    expect(card("Alice")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Bob/ })).toBeNull()

    // Two red chips keep whoever holds neither, and All clears the lot.
    fireEvent.click(filterChip("Operate"))
    expect(card("Carol")).toBeTruthy()
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(1)
    fireEvent.click(filterChip("All"))
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(3)
    expect(filterChip("Operate").getAttribute("aria-pressed")).toBe("false")
  })
})

describe("ResourceAccessFields — groups", () => {
  it("switches the catalog to groups with the name, display name and member count", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    expect(card("Bob")).toBeTruthy()
    switchToGroups()

    expect(card("Editors")).toBeTruthy()
    expect(screen.getByText("editors")).toBeTruthy()
    expect(screen.getByText("3 members")).toBeTruthy()
    expect(screen.getByText("1 member")).toBeTruthy()
    expect(screen.getByText("every account, including future ones")).toBeTruthy()
    expect(within(catalog()).queryByText(/^@/)).toBeNull()
  })

  it("ANDs the capability chips over the group catalog and cycles them", () => {
    const base = access({ groupGrants: { VIEW: [2, 3], OPERATE: [2], EDIT: [3] } })
    render(
      <ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={vi.fn()} />,
    )
    switchToGroups()

    fireEvent.click(filterChip("Operate"))
    expect(card("Editors")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Operations/ })).toBeNull()
    expect(within(catalog()).queryByRole("button", { name: /everyone/ })).toBeNull()

    fireEvent.click(filterChip("Edit"))
    expect(screen.getByText("No groups match.")).toBeTruthy()

    fireEvent.click(filterChip("Edit"))
    expect(card("Editors")).toBeTruthy()
    expect(within(catalog()).queryByRole("button", { name: /Operations/ })).toBeNull()

    fireEvent.click(filterChip("All"))
    expect(within(catalog()).queryAllByRole("button")).toHaveLength(3)
  })

  it("replace-sets a group's capabilities in the draft on Apply", () => {
    const base = access({ groupGrants: { VIEW: [2], OPERATE: [2], EDIT: [2] } })
    const onApply = vi.fn()
    render(
      <ResourceAccessFields resourceType="session" access={base} users={USERS} groups={GROUPS} onApply={onApply} />,
    )
    switchToGroups()

    fireEvent.click(card("Editors"))
    expect(setChip("Edit").getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(setChip("Edit"))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget
    expect([...(target.groupGrants?.EDIT ?? [])]).toEqual([])
    expect([...(target.groupGrants?.OPERATE ?? [])]).toEqual([2])
    expect([...(target.groupGrants?.VIEW ?? [])]).toEqual([2])

    fireEvent.click(setChip("View access"))
    fireEvent.click(applyButton())
    const second = onApply.mock.calls[1][0] as AccessTarget & GroupDraftTarget
    expect([...(second.groupGrants?.VIEW ?? [])]).toEqual([])
    expect([...(second.groupGrants?.OPERATE ?? [])]).toEqual([])
  })

  it("adds and removes owner groups without touching the user owner", () => {
    const onApply = vi.fn()
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ owner: "kyros", ownerGroups: [2] })}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    )

    expect(screen.getByRole("button", { name: "Remove owner group Editors" })).toBeTruthy()

    fireEvent.change(screen.getByRole("combobox", { name: "Add owner group" }), {
      target: { value: "operations" },
    })
    fireEvent.click(screen.getByRole("option", { name: /Operations/ }))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget
    expect([...(target.ownerGroups ?? [])].sort((a, b) => a - b)).toEqual([2, 3])
    expect(target.owner).toBe("kyros")

    fireEvent.click(screen.getByRole("button", { name: "Remove owner group Editors" }))
    fireEvent.click(applyButton())
    const second = onApply.mock.calls[1][0] as AccessTarget & GroupDraftTarget
    expect([...(second.ownerGroups ?? [])]).toEqual([3])
    expect(second.owner).toBe("kyros")
  })

  it("adds the highlighted owner group with the arrow keys and enter", () => {
    const onApply = vi.fn()
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    )

    const field = screen.getByRole("combobox", { name: "Add owner group" })
    fireEvent.focus(field)
    expect(screen.getAllByRole("option")).toHaveLength(3)
    fireEvent.keyDown(field, { key: "ArrowDown" })
    fireEvent.keyDown(field, { key: "Enter" })
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget
    expect([...(target.ownerGroups ?? [])]).toEqual([2])
  })

  it("warns loudly when the everyone group owns the item", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerGroups: [1] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    expect(screen.getByRole("alert").textContent).toBe(
      "Every account gets full control of this item, including delete.",
    )
  })

  it("raises the everyone warning only once the group is added as an owner", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.change(screen.getByRole("combobox", { name: "Add owner group" }), {
      target: { value: "everyone" },
    })
    fireEvent.click(screen.getByRole("option", { name: /Everyone/ }))
    expect(screen.getByRole("alert").textContent).toContain("Every account gets full control of this item")
  })

  it("keeps the owner transfer picker on the user catalog", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.queryByRole("group", { name: "Principal" })).toBeNull()
    expect(card("Carol")).toBeTruthy()
    expect(screen.queryByText("3 members")).toBeNull()
  })
})
