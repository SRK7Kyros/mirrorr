import { describe, expect, it } from "vitest"
import { diffDirtyFields, isDirty } from "./dirty"

describe("diffDirtyFields", () => {
  it("returns empty when nothing changed", () => {
    const initial = { a: 1, b: "x", c: { d: [1, 2] } }
    const current = structuredClone(initial)
    expect(diffDirtyFields(initial, current)).toEqual([])
  })

  it("detects scalar changes in both directions", () => {
    expect(diffDirtyFields({ a: 1 }, { a: 2 })).toEqual(["a"])
    expect(diffDirtyFields({ a: 1 }, { a: 1, b: "new" })).toEqual(["b"])
    expect(diffDirtyFields({ a: 1, b: "gone" }, { a: 1 })).toEqual(["b"])
  })

  it("compares nested objects and arrays structurally", () => {
    expect(diffDirtyFields({ c: { d: [1, 2] } }, { c: { d: [1, 2] } })).toEqual([])
    expect(diffDirtyFields({ c: { d: [1, 2] } }, { c: { d: [1, 3] } })).toEqual(["c"])
  })

  it("treats undefined-vs-missing as equal, null-vs-value as dirty", () => {
    expect(diffDirtyFields({ a: undefined }, {})).toEqual([])
    expect(diffDirtyFields({ a: null }, { a: 1 })).toEqual(["a"])
    expect(diffDirtyFields({ a: "" }, { a: "" })).toEqual([])
  })
})

describe("isDirty", () => {
  it("checks only the listed keys", () => {
    const initial = { a: 1, b: 2 }
    expect(isDirty(initial, { a: 1, b: 3 }, ["a"])).toBe(false)
    expect(isDirty(initial, { a: 1, b: 3 }, ["a", "b"])).toBe(true)
    expect(isDirty(initial, { a: 9 }, ["b"])).toBe(false)
  })
})
