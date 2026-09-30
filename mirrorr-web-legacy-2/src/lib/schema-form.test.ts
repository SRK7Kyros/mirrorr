/**
 * Pure helpers behind the dynamic forms.
 *
 * Contract: `docs/web-frontend-spec.md` L403 — `default`/`default_params`
 * prefill, `{...defaults, ...values}` emission, unknown extra keys rendered as
 * free-form key/value rows (client contract §8.1).
 */
import { describe, expect, it } from "vitest"
import { prefillValues, schemaDefaults, unknownPropertyKeys } from "@/lib/schema-form"
import { readJsonSchema } from "@/lib/schemas/json-schema"

const SCHEMA = readJsonSchema({
  type: "object",
  properties: {
    url: { type: "string", default: "https://example.com/live.m3u8" },
    count: { type: "integer", default: 3, minimum: 1 },
    headers: { type: "object", properties: { referer: { type: "string", default: "x" } } },
  },
  required: ["url"],
})

describe("prefillValues", () => {
  it("merges schema defaults with default_params, params winning", () => {
    expect(prefillValues(SCHEMA, { count: 7 })).toEqual({
      url: "https://example.com/live.m3u8",
      count: 7,
      headers: { referer: "x" },
    })
  })

  it("returns the schema defaults alone when no params are given", () => {
    expect(prefillValues(SCHEMA)).toEqual({
      url: "https://example.com/live.m3u8",
      count: 3,
      headers: { referer: "x" },
    })
  })

  it("returns an empty object for an undefined schema", () => {
    expect(prefillValues(undefined)).toEqual({})
  })
})

describe("unknownPropertyKeys", () => {
  it("lists the values whose keys the schema does not declare", () => {
    expect(unknownPropertyKeys(SCHEMA, { url: "x", extra: 1 })).toEqual(["extra"])
  })

  it("returns nothing when the schema closes additional properties", () => {
    const closed = readJsonSchema({
      type: "object",
      properties: { url: { type: "string" } },
      additionalProperties: false,
    })
    expect(unknownPropertyKeys(closed, { url: "x", extra: 1 })).toEqual([])
  })

  it("treats every key as unknown for a property-less open object", () => {
    const open = readJsonSchema({ type: "object", additionalProperties: { type: "string" } })
    expect(unknownPropertyKeys(open, { a: "1" })).toEqual(["a"])
  })
})

describe("schemaDefaults (existing contract)", () => {
  it("walks one level of nested object defaults", () => {
    expect(schemaDefaults(SCHEMA)).toEqual({
      url: "https://example.com/live.m3u8",
      count: 3,
      headers: { referer: "x" },
    })
  })
})
