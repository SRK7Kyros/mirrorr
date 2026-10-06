import { describe, expect, it } from "vitest"
import {
  clearPendingActions,
  getPendingActions,
  mutationInsert,
  reduceEntityList,
  setPendingAction,
} from "./entity-store"

interface Row {
  id: number
  status: string
  marker?: string
}

const MUTATION_ROW: Row = { id: 1, status: "active", marker: "mutation" }
const SNAPSHOT: Row = { id: 1, status: "completed", marker: "ws" }

describe("entity merge rules (Data Layer Contract §Entity merge rule)", () => {
  it("is arrival-order independent: mutation-then-WS ≡ WS-then-mutation", () => {
    const httpFirst = reduceEntityList(
      reduceEntityList([], { kind: "mutation", entity: MUTATION_ROW }),
      { kind: "authoritative", entity: SNAPSHOT },
    )
    const wsFirst = reduceEntityList(
      reduceEntityList([], { kind: "authoritative", entity: SNAPSHOT }),
      { kind: "mutation", entity: MUTATION_ROW },
    )

    expect(httpFirst).toEqual(wsFirst)
    expect(httpFirst[0]).toEqual(SNAPSHOT)
  })

  it("mutation responses insert only missing ids (cache wins if WS arrived first)", () => {
    const cached: Row[] = [{ id: 1, status: "completed" }]
    const afterMutation = mutationInsert(cached, { id: 1, status: "active" })
    expect(afterMutation).toBe(cached)
    expect(afterMutation[0]?.status).toBe("completed")

    const withNew = mutationInsert(cached, { id: 2, status: "active" })
    expect(withNew).toHaveLength(2)
    expect(withNew[0]?.id).toBe(2)
  })

  it("no-data frames never write fields", () => {
    const list: Row[] = [{ id: 1, status: "active" }]
    const next = reduceEntityList(list, { kind: "no-data" })
    expect(next).toBe(list)
    expect(next[0]).toEqual({ id: 1, status: "active" })
  })

  it("authoritative snapshots clear pendingActions (rule 4)", () => {
    setPendingAction(1, "stop")
    expect(getPendingActions(1)).toEqual(["stop"])

    reduceEntityList([{ id: 1, status: "active" }], {
      kind: "authoritative",
      entity: { id: 1, status: "terminating" },
    })

    expect(getPendingActions(1)).toEqual([])
  })

  it("deleted wins: removes the id and cancels pending actions (rule 5)", () => {
    setPendingAction(2, "delete")
    const list: Row[] = [
      { id: 2, status: "active" },
      { id: 3, status: "active" },
    ]

    const next = reduceEntityList(list, { kind: "deleted", id: 2 })

    expect(next.map((row) => row.id)).toEqual([3])
    expect(getPendingActions(2)).toEqual([])
    clearPendingActions(2)
  })
})
