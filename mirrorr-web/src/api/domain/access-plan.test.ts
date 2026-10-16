import { describe, expect, it, vi, beforeEach } from "vitest"
import { applyPlans, overrideOf, planBulk, planItem, type AccessRow } from "./access-plan"

vi.mock("@/api/endpoints/access", () => ({
  setResourceOwner: vi.fn(),
  grantResourceViewer: vi.fn(),
  revokeResourceViewer: vi.fn(),
}))

import * as api from "@/api/endpoints/access"

const setOwner = vi.mocked(api.setResourceOwner)
const grant = vi.mocked(api.grantResourceViewer)
const revoke = vi.mocked(api.revokeResourceViewer)

const USERS = ["kyros", "alice"]

function row(over: Partial<AccessRow> = {}): AccessRow {
  return {
    resourceType: "session",
    id: 1,
    label: "Sky Sports F1",
    access: { owner: "kyros", viewers: [] },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("overrideOf", () => {
  it("is null for an owner-only item", () => {
    expect(overrideOf({ owner: "kyros", viewers: [] }, USERS)).toBeNull()
  })

  it("flags an owner whose account is gone", () => {
    expect(overrideOf({ owner: "ghost", viewers: [] }, USERS)).toEqual({ kind: "owner-missing" })
  })

  it("flags explicit grants and counts them", () => {
    expect(overrideOf({ owner: "kyros", viewers: ["alice", "bob"] }, USERS)).toEqual({
      kind: "grants",
      count: 2,
    })
  })

  it("prefers the missing owner when both are true", () => {
    expect(overrideOf({ owner: "ghost", viewers: ["alice"] }, USERS)).toEqual({ kind: "owner-missing" })
  })

  it("treats an empty owner as ownerless, not missing", () => {
    expect(overrideOf({ owner: "", viewers: [] }, USERS)).toBeNull()
  })
})

describe("planItem", () => {
  it("emits one owner op when only the owner changes", () => {
    const plan = planItem(row(), { owner: "alice" }, USERS)
    expect(plan.ops).toEqual([{ kind: "owner", username: "alice" }])
    expect(plan.to).toEqual({ owner: "alice", viewers: [] })
  })

  it("leaves absent target fields untouched", () => {
    const plan = planItem(row({ access: { owner: "kyros", viewers: ["alice"] } }), {}, USERS)
    expect(plan.ops).toEqual([])
    expect(plan.to).toEqual({ owner: "kyros", viewers: ["alice"] })
  })

  it("grants added viewers and revokes removed ones", () => {
    const plan = planItem(
      row({ access: { owner: "kyros", viewers: ["alice", "bob"] } }),
      { viewers: ["alice", "carol"] },
      USERS,
    )
    expect(plan.ops).toEqual([
      { kind: "grant", username: "carol" },
      { kind: "revoke", username: "bob" },
    ])
  })

  it("emits nothing when the target equals the current state", () => {
    const plan = planItem(row({ access: { owner: "kyros", viewers: ["alice"] } }), { owner: "kyros", viewers: ["alice"] }, USERS)
    expect(plan.ops).toEqual([])
  })

  it("carries the override the item starts with, not the target", () => {
    const plan = planItem(row({ access: { owner: "ghost", viewers: ["alice"] } }), { owner: "kyros" }, USERS)
    expect(plan.override).toEqual({ kind: "owner-missing" })
    expect(plan.ops).toEqual([{ kind: "owner", username: "kyros" }])
  })
})

describe("planBulk", () => {
  it("counts ops across items", () => {
    const plan = planBulk(
      [row({ id: 1 }), row({ id: 2, access: { owner: "alice", viewers: [] } })],
      { owner: "kyros" },
      USERS,
    )
    expect(plan.opCount).toBe(1)
  })

  it("lists only items whose own access a change would overwrite", () => {
    const plan = planBulk(
      [
        row({ id: 1, label: "clean", access: { owner: "alice", viewers: [] } }),
        row({ id: 2, label: "shared", access: { owner: "alice", viewers: ["kyros"] } }),
        row({ id: 3, label: "ghosted", access: { owner: "ghost", viewers: [] } }),
        row({ id: 4, label: "already kyros", access: { owner: "kyros", viewers: [] } }),
      ],
      { owner: "kyros" },
      USERS,
    )
    expect(plan.overriding.map((item) => item.label)).toEqual(["shared", "ghosted"])
  })

  it("does not warn about an overridden item the change leaves alone", () => {
    const plan = planBulk([row({ access: { owner: "ghost", viewers: ["alice"] } })], {}, USERS)
    expect(plan.opCount).toBe(0)
    expect(plan.overriding).toEqual([])
  })
})

describe("applyPlans", () => {
  it("runs each op of each item in order and skips no-ops", async () => {
    const plan = planBulk(
      [
        row({ id: 1, access: { owner: "alice", viewers: ["bob"] } }),
        row({ id: 2, access: { owner: "kyros", viewers: ["alice"] } }),
      ],
      { owner: "kyros", viewers: ["alice"] },
      USERS,
    )
    const outcome = await applyPlans(plan.items)
    expect(setOwner).toHaveBeenCalledWith("session", 1, "kyros")
    expect(grant).toHaveBeenCalledWith("session", 1, "alice")
    expect(revoke).toHaveBeenCalledWith("session", 1, "bob")
    expect(setOwner).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledTimes(1)
    expect(outcome.applied.map((item) => item.id)).toEqual([1])
    expect(outcome.failed).toEqual([])
  })

  it("reports a failed item and still runs the rest", async () => {
    vi.mocked(api.setResourceOwner).mockRejectedValueOnce(new Error("403 Forbidden"))
    const plan = planBulk(
      [
        row({ id: 1, access: { owner: "alice", viewers: [] } }),
        row({ id: 2, access: { owner: "bob", viewers: [] } }),
      ],
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
