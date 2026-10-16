import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { AccessPanel } from "./access-panel"

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchResourceAccess: vi.fn(),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}))

// The panel reaches the wire through the planner, which reads this module directly.
const endpoints = vi.hoisted(() => ({
  setResourceOwner: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
}))

vi.mock("@/api", () => api)
vi.mock("@/api/endpoints/access", () => endpoints)

const USERS: readonly User[] = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
  { id: 3, username: "bob", role: "user", display_name: "Bob" },
  { id: 4, username: "carol", role: "user", display_name: "Carol" },
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
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <AccessPanel resourceType="session" id={1} label="F1 Weekend" onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

/** The search field only exists once the access read has landed. */
async function loaded(): Promise<void> {
  await screen.findByLabelText("Search users")
}

/** The catalog section whose heading is `heading`. */
async function section(heading: string): Promise<HTMLElement> {
  const found = (await screen.findByText(heading)).closest("section")
  if (found === null) throw new Error(`no section for ${heading}`)
  return found
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement
}

beforeEach(() => {
  vi.resetAllMocks()
  api.fetchUsers.mockResolvedValue(USERS)
  api.fetchResourceAccess.mockResolvedValue(accessView())
})

describe("AccessPanel", () => {
  it("shows the header, one section per capability in frozen order, and the owner catalog", async () => {
    renderPanel()

    expect(await screen.findByText("Access · F1 Weekend")).toBeTruthy()
    expect(screen.getByText("Session · #1")).toBeTruthy()
    await loaded()

    expect([...CAPABILITIES]).toEqual(["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT"])
    const headings = ["Owner", "View access", "Operate", "Edit", "Delete", "Share", "Export"].map((text) =>
      screen.getByText(text),
    )
    for (let index = 1; index < headings.length; index += 1) {
      const relation = headings[index - 1].compareDocumentPosition(headings[index])
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByText("Only the owner can see this item.")).toBeTruthy()
  })

  it("filters the card catalog by username and display name as you type", async () => {
    renderPanel()

    const view = await section("View access")
    await within(view).findByRole("button", { name: /Bob/ })
    expect(within(view).getByRole("button", { name: /Alice/ })).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "ali" } })

    expect(within(view).getByRole("button", { name: /Alice/ })).toBeTruthy()
    expect(within(view).queryByRole("button", { name: /Bob/ })).toBeNull()
    expect(within(view).queryByRole("button", { name: /Carol/ })).toBeNull()
  })

  it("shows an empty catalog state when nothing matches", async () => {
    renderPanel()

    await section("View access")
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "zzzznobody" } })

    expect(screen.getByText("No users match.")).toBeTruthy()
    expect(screen.getAllByText("No other users match.")).toHaveLength(CAPABILITIES.length)
  })

  it("never offers the item's own owner as a grant target", async () => {
    renderPanel()

    const view = await section("View access")
    await within(view).findByRole("button", { name: /Alice/ })
    expect(within(view).queryByRole("button", { name: /Kyros/ })).toBeNull()
    expect(within(await section("Owner")).getByRole("button", { name: /Kyros/ })).toBeTruthy()
  })

  it("keeps Apply disabled until the draft is dirty", async () => {
    renderPanel()

    await loaded()
    expect(applyButton().disabled).toBe(true)

    fireEvent.click(within(await section("View access")).getByRole("button", { name: /Bob/ }))

    expect(applyButton().disabled).toBe(false)
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
  })

  it("grants a capability on tap and emits nothing until Apply", async () => {
    renderPanel()

    const card = await within(await section("View access")).findByRole("button", { name: /Bob/ })
    fireEvent.click(card)

    expect(card.getAttribute("aria-pressed")).toBe("true")
    // Drafting alone must reach no wire — a control that only looks like it grants fails here.
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled()
    expect(endpoints.setResourceOwner).not.toHaveBeenCalled()

    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(1))
    expect(endpoints.setResourceGrants).toHaveBeenCalledWith("session", 1, "bob", ["VIEW"])
  })

  it("revokes a capability on a second tap and clears the user when nothing is left", async () => {
    api.fetchResourceAccess.mockResolvedValue(accessView({ grants: { VIEW: ["bob"] } }))
    renderPanel()

    const card = await within(await section("View access")).findByRole("button", { name: /Bob/ })
    expect(card.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(card)
    expect(card.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.revokeResourceUser).toHaveBeenCalledTimes(1))
    expect(endpoints.revokeResourceUser).toHaveBeenCalledWith("session", 1, "bob")
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled()
  })

  it("keeps the owner single-select and transfers it on Apply", async () => {
    renderPanel()

    const owner = await section("Owner")
    const kyros = await within(owner).findByRole("button", { name: /Kyros/ })
    const alice = within(owner).getByRole("button", { name: /Alice/ })
    expect(kyros.getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(alice)
    expect(alice.getAttribute("aria-pressed")).toBe("true")
    expect(kyros.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceOwner).toHaveBeenCalledTimes(1))
    expect(endpoints.setResourceOwner).toHaveBeenCalledWith("session", 1, "alice")
  })

  it("grants OPERATE for a user and posts their whole resulting capability set", async () => {
    renderPanel()

    fireEvent.click(await within(await section("View access")).findByRole("button", { name: /Bob/ }))
    fireEvent.click(within(await section("Operate")).getByRole("button", { name: /Bob/ }))
    fireEvent.click(applyButton())

    await waitFor(() => expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(2))
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(1, "session", 1, "bob", ["VIEW", "OPERATE"])
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(2, "session", 1, "bob", ["VIEW", "OPERATE"])
  })

  it("pins the dirty indicator and Apply in the dialog footer, outside the scroll body", async () => {
    renderPanel()
    await loaded()

    const dialog = screen.getByRole("dialog")
    // The catalog's nearest overflow-y-auto ancestor is the Dialog body (the scroll region).
    const body = (await section("View access")).closest(".overflow-y-auto")
    // Guard against a vacuous pass: the catalog really does sit inside a scroll region.
    expect(body).not.toBeNull()
    expect(body).not.toBe(dialog)

    const indicator = screen.getByText("Up to date")
    const apply = applyButton()

    expect(body!.contains(indicator)).toBe(false)
    expect(body!.contains(apply)).toBe(false)
    expect(dialog.contains(indicator)).toBe(true)
    expect(dialog.contains(apply)).toBe(true)
  })
})
