import { describe, expect, it } from "vitest"
import type { ImportItem } from "@/api"
import {
  applyBlockReason,
  collisionDeletions,
  collisionOf,
  countByKind,
  createdNames,
  dedupeProfiles,
  defaultIncluded,
  initialResolutions,
  itemKey,
  needsResolution,
  selectedCounts,
  selectionLabel,
  withCollision,
  withIncluded,
} from "./import-logic"

function item(overrides: Partial<ImportItem> & { name: string }): ImportItem {
  return {
    kind: "profile",
    status: "ready",
    issues: [],
    entry: {},
    ...overrides,
  }
}

const READY = item({ name: "Speedcubing" })
const MAPPING = item({
  name: "Harbour cam",
  issues: [{ type: "not_installed", field: "engine" }],
})
const CONFLICT = item({
  name: "F1 Weekend",
  issues: [{ type: "name_conflict", existing_id: 5, new_name: "F1 Weekend_2" }],
})
const IDENTICAL = item({ name: "Nightly", issues: [{ type: "already_exists", existing_id: 7 }] })
const AUTORUN = item({ name: "Race day", kind: "autorun" })

describe("import preview defaults", () => {
  it("selects only items the server can create without a decision", () => {
    expect(defaultIncluded(READY)).toBe(true)
    expect(defaultIncluded(MAPPING)).toBe(true)
    expect(defaultIncluded(CONFLICT)).toBe(false)
    expect(defaultIncluded(IDENTICAL)).toBe(false)
  })

  it("opens a collision on Skip, not on the badge's says-so", () => {
    const resolutions = initialResolutions([CONFLICT, READY, AUTORUN])
    expect(resolutions[itemKey(CONFLICT)]).toEqual({ included: false, collision: "skip" })
    expect(resolutions[itemKey(READY)]).toEqual({ included: true })
    expect(resolutions[itemKey(AUTORUN)]).toEqual({ included: true })
  })

  it("counts the selection rather than the bundle", () => {
    const resolutions = initialResolutions([CONFLICT, READY, AUTORUN])
    expect(selectionLabel([CONFLICT, READY, AUTORUN], resolutions)).toBe("2 of 3 selected")
  })

  it("counts included items per type for the summary line", () => {
    const resolutions = initialResolutions([CONFLICT, READY, AUTORUN])
    expect(countByKind([CONFLICT, READY, AUTORUN])).toEqual({ profiles: 2, autoruns: 1 })
    expect(selectedCounts([CONFLICT, READY, AUTORUN], resolutions)).toEqual({
      profiles: 1,
      autoruns: 1,
    })
  })
})

describe("mapping decisions", () => {
  it("asks only for the issues a lookup can answer", () => {
    expect(needsResolution(READY)).toBe(false)
    expect(needsResolution(CONFLICT)).toBe(false)
    expect(needsResolution(MAPPING)).toBe(true)
  })
})

describe("import apply gate", () => {
  it("refuses an empty bundle with its own reason", () => {
    expect(applyBlockReason([], {})).toBe("This bundle contains no items to import.")
  })

  it("refuses an unselected bundle and says so", () => {
    const resolutions = { [itemKey(CONFLICT)]: { included: false, collision: "skip" as const } }
    expect(applyBlockReason([CONFLICT], resolutions)).toBe("Select at least one item to import.")
  })

  it("allows a non-empty selection", () => {
    expect(applyBlockReason([READY], initialResolutions([READY]))).toBeNull()
  })
})

describe("collision decisions", () => {
  it("reads the installed id and the renamed copy off the issue", () => {
    expect(collisionOf(CONFLICT)).toEqual({ existingId: 5, keepName: "F1 Weekend_2" })
    expect(collisionOf(READY)).toBeNull()
  })

  it("keeps the checkbox authoritative when it is toggled", () => {
    const resolved = withCollision({ included: false, collision: "skip" }, "keep")
    expect(resolved).toEqual({ included: true, collision: "keep" })
    expect(withIncluded(resolved, false)).toEqual({ included: false, collision: "keep" })
  })

  it("deletes the installed item only for Replace", () => {
    const keep = { [itemKey(CONFLICT)]: { included: true, collision: "keep" as const } }
    const replace = { [itemKey(CONFLICT)]: { included: true, collision: "replace" as const } }
    const skip = { [itemKey(CONFLICT)]: { included: false, collision: "skip" as const } }
    expect(collisionDeletions([CONFLICT], keep)).toEqual([])
    expect(collisionDeletions([CONFLICT], skip)).toEqual([])
    expect(collisionDeletions([CONFLICT], replace)).toEqual([{ kind: "profile", id: 5 }])
  })

  it("predicts the stored names, which is what undo matches on", () => {
    const resolutions = {
      [itemKey(CONFLICT)]: { included: true, collision: "keep" as const },
      [itemKey(READY)]: { included: true },
      [itemKey(IDENTICAL)]: { included: false },
      [itemKey(AUTORUN)]: { included: true },
    }
    expect(createdNames([CONFLICT, READY, IDENTICAL, AUTORUN], resolutions)).toEqual({
      profiles: ["F1 Weekend_2", "Speedcubing"],
      autoruns: ["Race day"],
    })
  })

  it("keeps the bundled name when Replace wins", () => {
    const resolutions = { [itemKey(CONFLICT)]: { included: true, collision: "replace" as const } }
    expect(createdNames([CONFLICT], resolutions)).toEqual({
      profiles: ["F1 Weekend"],
      autoruns: [],
    })
  })
})

describe("export bundle merge", () => {
  it("keeps one copy of a profile an autorun export already carries", () => {
    const merged = dedupeProfiles({
      version: 1,
      profiles: [{ name: "F1 Weekend" }, { name: "F1 Weekend" }, { name: "Nightly" }],
      autoruns: [{ user_friendly_name: "Race day" }],
    })
    expect(merged).toEqual({
      version: 1,
      profiles: [{ name: "F1 Weekend" }, { name: "Nightly" }],
      autoruns: [{ user_friendly_name: "Race day" }],
    })
  })

  it("passes a non-object through untouched", () => {
    expect(dedupeProfiles(null)).toBeNull()
  })
})
