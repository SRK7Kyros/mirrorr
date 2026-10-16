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
import { ResourceAccessFields } from "./resource-access"

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

/** A capability section's container, located by its heading text. */
function section(heading: string): HTMLElement {
  const parent = screen.getByText(heading).parentElement
  if (parent === null) throw new Error(`no section container for ${heading}`)
  return parent
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement
}

describe("ResourceAccessFields", () => {
  it("renders one section per capability in the frozen order, after the owner control", () => {
    render(<ResourceAccessFields access={access()} users={USERS} onApply={vi.fn()} />)

    expect([...CAPABILITIES]).toEqual(["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"])
    const expected = ["View access", "Operate", "Edit", "Delete", "Share", "Export"]
    const headings = expected.map((text) => screen.getByText(text))
    for (let index = 1; index < headings.length; index += 1) {
      const relation = headings[index - 1].compareDocumentPosition(headings[index])
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByLabelText("Owner")).toBeTruthy()
    expect(screen.getByText("Only the owner can see this item.")).toBeTruthy()
    expect(screen.getByText("Up to date")).toBeTruthy()
  })

  it("keeps Apply disabled until the draft is dirty", () => {
    render(<ResourceAccessFields access={access()} users={USERS} onApply={vi.fn()} />)
    expect(applyButton().disabled).toBe(true)

    const view = section("View access")
    fireEvent.change(within(view).getByLabelText("Add a viewer"), { target: { value: "bob" } })
    fireEvent.click(within(view).getByRole("button", { name: "Add" }))

    expect(applyButton().disabled).toBe(false)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("keeps the owner control single-valued", () => {
    const onApply = vi.fn()
    render(<ResourceAccessFields access={access()} users={USERS} onApply={onApply} />)

    const owner = screen.getByLabelText("Owner") as HTMLSelectElement
    expect(owner.tagName).toBe("SELECT")
    expect(owner.value).toBe("kyros")

    fireEvent.change(owner, { target: { value: "carol" } })
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.owner).toBe("carol")
  })

  it("grants VIEW then OPERATE for one user as two grants, each issued as a request", async () => {
    const base = access()
    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    const view = section("View access")
    fireEvent.change(within(view).getByLabelText("Add a viewer"), { target: { value: "bob" } })
    fireEvent.click(within(view).getByRole("button", { name: "Add" }))

    const operate = section("Operate")
    fireEvent.change(within(operate).getByLabelText("Add user to Operate"), { target: { value: "bob" } })
    fireEvent.click(within(operate).getByRole("button", { name: "Add to Operate" }))

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
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(1, "session", 1, "bob", [
      "VIEW",
      "OPERATE",
    ])
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(2, "session", 1, "bob", [
      "VIEW",
      "OPERATE",
    ])
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
  })

  it("revoking VIEW leaves OPERATE intact and clears only the VIEW grant", async () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] })
    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    fireEvent.click(within(section("View access")).getByLabelText("Remove bob"))
    expect(within(section("View access")).getByText("Only the owner can see this item.")).toBeTruthy()
    expect(within(section("Operate")).getByText("Bob")).toBeTruthy()

    fireEvent.click(applyButton())
    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.VIEW).toEqual([])
    expect(target.grants?.OPERATE).toEqual(["bob"])

    const plan = planItem(row(base), target, USERNAMES)
    expect(plan.ops).toEqual([{ kind: "revoke", capability: "VIEW", username: "bob" }])

    await applyPlans([plan])
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "bob", ["OPERATE"])
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
  })

  it("reloads on a changed access prop and preserves the draft on an unchanged one", () => {
    const base = access()
    const { rerender } = render(
      <ResourceAccessFields access={base} users={USERS} onApply={vi.fn()} />,
    )

    const view = section("View access")
    fireEvent.change(within(view).getByLabelText("Add a viewer"), { target: { value: "bob" } })
    fireEvent.click(within(view).getByRole("button", { name: "Add" }))
    expect(within(section("View access")).getByLabelText("Remove bob")).toBeTruthy()
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Same value → same signature → the in-flight edit survives.
    rerender(<ResourceAccessFields access={base} users={USERS} onApply={vi.fn()} />)
    expect(within(section("View access")).getByLabelText("Remove bob")).toBeTruthy()
    expect(screen.getByText("Unsaved changes")).toBeTruthy()

    // Different value → the draft reloads from the server state.
    rerender(<ResourceAccessFields access={access({ VIEW: ["alice"] })} users={USERS} onApply={vi.fn()} />)
    expect(within(section("View access")).getByLabelText("Remove alice")).toBeTruthy()
    expect(within(section("View access")).queryByLabelText("Remove bob")).toBeNull()
    expect(screen.getByText("Up to date")).toBeTruthy()
    expect(applyButton().disabled).toBe(true)
  })

  it("disables Apply and every row control while busy", () => {
    render(
      <ResourceAccessFields access={access({ VIEW: ["bob"] })} users={USERS} busy onApply={vi.fn()} />,
    )

    // The Spinner contributes "Loading" to the button's accessible name, so
    // locate the Apply control by its label span instead of the composed name.
    const applyControl = screen.getByText("Apply changes").closest("button")
    expect(applyControl).not.toBeNull()
    expect((applyControl as HTMLButtonElement).disabled).toBe(true)
    const view = section("View access")
    expect((within(view).getByLabelText("Remove bob") as HTMLButtonElement).disabled).toBe(true)
    expect((within(view).getByLabelText("Add a viewer") as HTMLSelectElement).disabled).toBe(true)
    expect((within(view).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("carries all six capability keys and grants onto an otherwise-empty capability", () => {
    const base = access()
    expect(Object.keys(base.grants).sort()).toEqual([...CAPABILITIES].sort())

    const onApply = vi.fn()
    render(<ResourceAccessFields access={base} users={USERS} onApply={onApply} />)

    const exportSection = section("Export")
    fireEvent.change(within(exportSection).getByLabelText("Add user to Export"), {
      target: { value: "bob" },
    })
    fireEvent.click(within(exportSection).getByRole("button", { name: "Add to Export" }))
    fireEvent.click(applyButton())

    const target = onApply.mock.calls[0][0] as AccessTarget
    expect(target.grants?.EXPORT).toEqual(["bob"])
    for (const capability of CAPABILITIES) {
      if (capability !== "EXPORT") expect(target.grants?.[capability]).toEqual([])
    }
  })
})
