import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  applyPlans,
  emptyGrants,
  emptyGroupGrants,
  grantedGroupIds,
  grantedUsernames,
  itemAccessFromView,
  overrideOf,
  planBulk,
  planItem,
  type AccessRow,
  type ItemAccess,
} from "./access-plan"
import type { AccessView, Capability } from "@/api/schemas/privileged"

vi.mock("@/api/endpoints/access", () => ({
  setResourceOwner: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
  setGroupGrants: vi.fn(),
  revokeGroupGrants: vi.fn(),
  addResourceOwnerGroup: vi.fn(),
  removeResourceOwnerGroup: vi.fn(),
}))

import * as api from "@/api/endpoints/access"

const setOwner = vi.mocked(api.setResourceOwner)
const grant = vi.mocked(api.setResourceGrants)
const revoke = vi.mocked(api.revokeResourceUser)
const setGroup = vi.mocked(api.setGroupGrants)
const revokeGroup = vi.mocked(api.revokeGroupGrants)
const addOwnerGroup = vi.mocked(api.addResourceOwnerGroup)
const removeOwnerGroup = vi.mocked(api.removeResourceOwnerGroup)

const USERS = ["kyros", "alice"]

function grants(over: Partial<Record<Capability, string[]>> = {}): Record<Capability, string[]> {
  return { ...emptyGrants(), ...over }
}

function groupGrantsOf(over: Partial<Record<Capability, number[]>> = {}): Record<Capability, number[]> {
  return { ...emptyGroupGrants(), ...over }
}

function access(over: Partial<ItemAccess> = {}): ItemAccess {
  return { owner: "kyros", ownerMissing: false, grants: grants(), ...over }
}

function row(over: Partial<AccessRow> = {}): AccessRow {
  return {
    resourceType: "session",
    id: 1,
    label: "Sky Sports F1",
    access: access(),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("itemAccessFromView", () => {
  it("maps the wire AccessView onto a full grant record", () => {
    const view: AccessView = {
      resource_type: "session",
      id: 7,
      owner: "kyros",
      owner_missing: false,
      grants: [{ username: "bob", capabilities: ["OPERATE", "VIEW"] }],
      owner_groups: [],
      group_grants: [],
    }
    const item = itemAccessFromView(view)
    expect(item.owner).toBe("kyros")
    expect(item.grants.VIEW).toEqual(["bob"])
    expect(item.grants.OPERATE).toEqual(["bob"])
    expect(item.grants.EXPORT).toEqual([])
  })

  it("carries a missing owner and a null owner through unchanged", () => {
    const item = itemAccessFromView({
      resource_type: "session",
      id: 7,
      owner: null,
      owner_missing: true,
      grants: [],
      owner_groups: [],
      group_grants: [],
    })
    expect(item.owner).toBeNull()
    expect(item.ownerMissing).toBe(true)
  })
})

describe("grantedUsernames", () => {
  it("unions usernames across every capability, once each", () => {
    const item = access({ grants: grants({ VIEW: ["alice"], OPERATE: ["bob"], EDIT: ["alice"] }) })
    expect(grantedUsernames(item).sort()).toEqual(["alice", "bob"])
  })
})

describe("overrideOf", () => {
  it("is null for an owner-only item", () => {
    expect(overrideOf(access(), USERS)).toBeNull()
  })

  it("flags an owner the server reports as missing", () => {
    expect(overrideOf(access({ owner: "ghost", ownerMissing: true }), USERS)).toEqual({
      kind: "owner-missing",
    })
  })

  it("flags an owner absent from the user list", () => {
    expect(overrideOf(access({ owner: "ghost" }), USERS)).toEqual({ kind: "owner-missing" })
  })

  it("flags explicit grants and counts distinct users", () => {
    const item = access({ grants: grants({ VIEW: ["alice"], OPERATE: ["bob"], EDIT: ["alice"] }) })
    expect(overrideOf(item, USERS)).toEqual({ kind: "grants", count: 2 })
  })

  it("prefers the missing owner when both are true", () => {
    expect(overrideOf(access({ owner: "ghost", grants: grants({ VIEW: ["alice"] }) }), USERS)).toEqual({
      kind: "owner-missing",
    })
  })

  it("treats a null or empty owner as ownerless, not missing", () => {
    expect(overrideOf(access({ owner: null }), USERS)).toBeNull()
    expect(overrideOf(access({ owner: "" }), USERS)).toBeNull()
  })
})

describe("planItem", () => {
  it("emits one owner op when only the owner changes", () => {
    const plan = planItem(row(), { owner: "alice" }, USERS)
    expect(plan.ops).toEqual([{ kind: "owner", username: "alice" }])
    expect(plan.to.owner).toBe("alice")
  })

  it("leaves absent target fields untouched", () => {
    const plan = planItem(row({ access: access({ grants: grants({ VIEW: ["alice"] }) }) }), {}, USERS)
    expect(plan.ops).toEqual([])
    expect(plan.to.grants.VIEW).toEqual(["alice"])
  })

  it("grants an added VIEW and revokes a removed VIEW", () => {
    const plan = planItem(
      row({ access: access({ grants: grants({ VIEW: ["alice", "bob"] }) }) }),
      { grants: { VIEW: ["alice", "carol"] } },
      USERS,
    )
    expect(plan.ops).toEqual([
      { kind: "grant", capability: "VIEW", username: "carol" },
      { kind: "revoke", capability: "VIEW", username: "bob" },
    ])
  })

  it("diffs each capability independently", () => {
    const plan = planItem(
      row({ access: access({ grants: grants({ VIEW: ["bob"] }) }) }),
      { grants: { VIEW: [], OPERATE: ["bob"] } },
      USERS,
    )
    expect(plan.ops).toEqual([
      { kind: "revoke", capability: "VIEW", username: "bob" },
      { kind: "grant", capability: "OPERATE", username: "bob" },
    ])
  })

  it("grants a second capability without disturbing the first", () => {
    const plan = planItem(
      row({ access: access({ grants: grants({ VIEW: ["alice"] }) }) }),
      { grants: { VIEW: ["alice"], OPERATE: ["alice"] } },
      USERS,
    )
    expect(plan.ops).toEqual([{ kind: "grant", capability: "OPERATE", username: "alice" }])
  })

  it("emits nothing when the target equals the current state", () => {
    const plan = planItem(
      row({ access: access({ grants: grants({ VIEW: ["alice"] }) }) }),
      { owner: "kyros", grants: { VIEW: ["alice"] } },
      USERS,
    )
    expect(plan.ops).toEqual([])
  })

  it("carries the override the item starts with, not the target", () => {
    const plan = planItem(
      row({ access: access({ owner: "ghost", grants: grants({ VIEW: ["alice"] }) }) }),
      { owner: "kyros" },
      USERS,
    )
    expect(plan.override).toEqual({ kind: "owner-missing" })
    expect(plan.ops).toEqual([{ kind: "owner", username: "kyros" }])
  })
})

describe("planBulk", () => {
  it("counts ops across items", () => {
    const plan = planBulk(
      [row({ id: 1 }), row({ id: 2, access: access({ owner: "alice" }) })],
      { owner: "kyros" },
      USERS,
    )
    expect(plan.opCount).toBe(1)
  })

  it("lists only items whose own access a change would overwrite", () => {
    const plan = planBulk(
      [
        row({ id: 1, label: "clean", access: access({ owner: "alice" }) }),
        row({ id: 2, label: "shared", access: access({ owner: "alice", grants: grants({ VIEW: ["kyros"] }) }) }),
        row({ id: 3, label: "ghosted", access: access({ owner: "ghost" }) }),
        row({ id: 4, label: "already kyros", access: access({ owner: "kyros" }) }),
      ],
      { owner: "kyros" },
      USERS,
    )
    expect(plan.overriding.map((item) => item.label)).toEqual(["shared", "ghosted"])
  })

  it("does not warn about an overridden item the change leaves alone", () => {
    const plan = planBulk(
      [row({ access: access({ owner: "ghost", grants: grants({ VIEW: ["alice"] }) }) })],
      {},
      USERS,
    )
    expect(plan.opCount).toBe(0)
    expect(plan.overriding).toEqual([])
  })
})

describe("applyPlans", () => {
  it("runs each op of each item in order and skips no-ops", async () => {
    const plan = planBulk(
      [
        row({ id: 1, access: access({ owner: "alice", grants: grants({ VIEW: ["bob"] }) }) }),
        row({ id: 2, access: access({ owner: "kyros", grants: grants({ VIEW: ["alice"] }) }) }),
      ],
      { owner: "kyros", grants: { VIEW: ["alice"] } },
      USERS,
    )
    const outcome = await applyPlans(plan.items)
    expect(setOwner).toHaveBeenCalledWith("session", 1, "kyros")
    expect(grant).toHaveBeenCalledWith("session", 1, "alice", ["VIEW"])
    expect(revoke).toHaveBeenCalledWith("session", 1, "bob")
    expect(setOwner).toHaveBeenCalledTimes(1)
    expect(outcome.applied.map((item) => item.id)).toEqual([1])
    expect(outcome.failed).toEqual([])
  })

  it("posts the user's whole resulting capability set on a grant", async () => {
    const plan = planBulk(
      [row({ id: 1, access: access({ grants: grants({ VIEW: ["bob"] }) }) })],
      { grants: { VIEW: ["bob"], OPERATE: ["bob"] } },
      USERS,
    )
    await applyPlans(plan.items)
    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledWith("session", 1, "bob", ["VIEW", "OPERATE"])
  })

  it("clears a user through the DELETE route when their last capability goes", async () => {
    const plan = planBulk(
      [row({ id: 1, access: access({ grants: grants({ VIEW: ["bob"] }) }) })],
      { grants: { VIEW: [] } },
      USERS,
    )
    await applyPlans(plan.items)
    expect(revoke).toHaveBeenCalledWith("session", 1, "bob")
    expect(grant).not.toHaveBeenCalled()
  })

  it("emits and sends nothing when the target equals the current state", async () => {
    const plan = planItem(
      row({ access: access({ grants: grants({ VIEW: ["alice"], OPERATE: ["bob"] }) }) }),
      { owner: "kyros", grants: { VIEW: ["alice"], OPERATE: ["bob"] } },
      USERS,
    )
    expect(plan.ops).toEqual([])
    const outcome = await applyPlans([plan])
    expect(outcome.applied).toEqual([])
    expect(setOwner).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it("reports a failed item and still runs the rest", async () => {
    vi.mocked(api.setResourceOwner).mockRejectedValueOnce(new Error("403 Forbidden"))
    const plan = planBulk(
      [row({ id: 1, access: access({ owner: "alice" }) }), row({ id: 2, access: access({ owner: "bob" }) })],
      { owner: "kyros" },
      USERS,
    )
    const outcome = await applyPlans(plan.items)
    expect(outcome.applied.map((item) => item.id)).toEqual([2])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0].plan.id).toBe(1)
    expect(outcome.failed[0].message).toBeTruthy()
  })
})

describe("itemAccessFromView groups", () => {
  it("maps group grants and owner groups onto the record", () => {
    const item = itemAccessFromView({
      resource_type: "session",
      id: 7,
      owner: "kyros",
      owner_missing: false,
      grants: [],
      owner_groups: [{ id: 3, name: "editors", display_name: "Editors", system: false }],
      group_grants: [
        {
          group_id: 4,
          name: "everyone",
          display_name: "Everyone",
          system: true,
          capabilities: ["VIEW", "OPERATE"],
        },
      ],
    })
    expect(grantedGroupIds(item)).toEqual([4])
    expect(item.groupGrants?.VIEW).toEqual([4])
    expect(item.groupGrants?.OPERATE).toEqual([4])
    expect(item.ownerGroups).toEqual([3])
  })
})

describe("overrideOf groups", () => {
  it("counts groups beside users", () => {
    const item = access({ grants: grants({ VIEW: ["alice"] }), groupGrants: groupGrantsOf({ VIEW: [4] }) })
    expect(overrideOf(item, USERS)).toEqual({ kind: "grants", count: 2 })
  })

  it("flags a group-only grant", () => {
    expect(overrideOf(access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }), USERS)).toEqual({
      kind: "grants",
      count: 1,
    })
  })
})

describe("planItem groups", () => {
  it("emits one op per group whose capabilities change", () => {
    const plan = planItem(
      row({ access: access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }) }),
      { groupGrants: { VIEW: [4], OPERATE: [4] } },
      USERS,
    )
    expect(plan.ops).toEqual([{ kind: "group", groupId: 4 }])
  })

  it("emits a group op when a group's last capability goes", () => {
    const plan = planItem(
      row({ access: access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }) }),
      { groupGrants: { VIEW: [] } },
      USERS,
    )
    expect(plan.ops).toEqual([{ kind: "group", groupId: 4 }])
  })

  it("emits nothing when the group set is unchanged", () => {
    const plan = planItem(
      row({ access: access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }) }),
      { groupGrants: { VIEW: [4] } },
      USERS,
    )
    expect(plan.ops).toEqual([])
  })

  it("adds and removes owner groups", () => {
    const plan = planItem(row({ access: access({ ownerGroups: [3] }) }), { ownerGroups: [4] }, USERS)
    expect(plan.ops).toEqual([
      { kind: "owner-group", groupId: 4, owner: true },
      { kind: "owner-group", groupId: 3, owner: false },
    ])
  })

  it("leaves owner groups alone when the target omits them", () => {
    const plan = planItem(row({ access: access({ ownerGroups: [3] }) }), { owner: "alice" }, USERS)
    expect(plan.ops).toEqual([{ kind: "owner", username: "alice" }])
    expect(plan.to.ownerGroups).toEqual([3])
  })
})

describe("applyPlans groups", () => {
  it("writes a group's whole capability set through the replace-set route", async () => {
    const plan = planItem(
      row({ access: access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }) }),
      { groupGrants: { VIEW: [4], OPERATE: [4] } },
      USERS,
    )
    await applyPlans([plan])
    expect(setGroup).toHaveBeenCalledWith("session", 1, 4, ["VIEW", "OPERATE"])
  })

  it("clears a group through the DELETE route when its last capability goes", async () => {
    const plan = planItem(
      row({ access: access({ groupGrants: groupGrantsOf({ VIEW: [4] }) }) }),
      { groupGrants: { VIEW: [] } },
      USERS,
    )
    await applyPlans([plan])
    expect(revokeGroup).toHaveBeenCalledWith("session", 1, 4)
    expect(setGroup).not.toHaveBeenCalled()
  })

  it("adds and removes owner groups through their own routes", async () => {
    const plan = planItem(row({ access: access({ ownerGroups: [3] }) }), { ownerGroups: [4] }, USERS)
    await applyPlans([plan])
    expect(addOwnerGroup).toHaveBeenCalledWith("session", 1, 4)
    expect(removeOwnerGroup).toHaveBeenCalledWith("session", 1, 3)
  })
})
