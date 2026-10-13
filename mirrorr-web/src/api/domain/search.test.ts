import { describe, expect, it } from "vitest"
import { queryWords, rankBySearch, scoreMatch } from "./search"

const ITEM = "fo bar salamaleko"
const score = (query: string) => scoreMatch(ITEM, queryWords(query))

describe("queryWords", () => {
  it("lowercases and splits on anything that is not a letter or digit", () => {
    expect(queryWords("Live  Sport!")).toEqual(["live", "sport"])
    expect(queryWords("dvr_hls #101")).toEqual(["dvr", "hls", "101"])
  })

  it("drops repeats and empties", () => {
    expect(queryWords("live live  ")).toEqual(["live"])
    expect(queryWords("   ")).toEqual([])
  })
})

describe("scoreMatch", () => {
  it("scores every word of the query, whatever the order", () => {
    const words = scoreMatch(ITEM, ["foo", "bar", "zzz"])
    expect(words).toBeGreaterThan(0)
    expect(scoreMatch(ITEM, ["bar", "foo"])).toBe(scoreMatch(ITEM, ["foo", "bar"]))
    expect(scoreMatch(ITEM, ["foo", "bar", "salamalenko"])).toBe(score("foo bar salamalenko"))
  })

  it("keeps most of a word's score when a letter is inserted", () => {
    expect(score("salamalenko")).toBeGreaterThan(score("salamanleko"))
    expect(score("salamalenko")).toBeLessThan(score("salamaleko"))
    expect(score("salamalenko")).toBeGreaterThan(score("salamaleko") * 0.5)
  })

  it("charges a word for the characters it gets wrong", () => {
    expect(score("salamanleko")).toBeGreaterThan(score("salamahadhasdahdahsleko"))
    expect(score("salamahadhasdahdahsleko")).toBeGreaterThan(0)
  })

  it("scores a fully contained word by its runs alone", () => {
    expect(score("salam")).toBe(25)
  })

  it("gives longer groups a bonus", () => {
    expect(scoreMatch("abcdef", ["ab", "cdef"])).toBeGreaterThan(scoreMatch("abcdef", ["abc", "def"]))
  })

  it("matches characters, not tokens", () => {
    expect(scoreMatch("deliver", queryWords("live"))).toBeGreaterThan(0)
    expect(scoreMatch("sessions-list", queryWords("sess"))).toBeGreaterThan(0)
  })

  it("ignores runs too short to be a group", () => {
    expect(scoreMatch(ITEM, queryWords("zzz"))).toBe(0)
    expect(scoreMatch(ITEM, queryWords("ah"))).toBe(0)
  })

  it("is case insensitive", () => {
    expect(scoreMatch("SALAMALEKO", queryWords("salamaleko"))).toBe(scoreMatch("salamaleko", queryWords("salamaleko")))
  })
})

describe("rankBySearch", () => {
  const items = [{ name: "live news" }, { name: "live" }, { name: "static" }]
  const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name)

  it("drops items sharing nothing and ranks the rest best first", () => {
    expect(names(rankBySearch(items, "live news", (item) => [item.name]))).toEqual([
      "live news",
      "live",
    ])
  })

  it("keeps an item that matches only some of the query", () => {
    expect(names(rankBySearch(items, "zzz news", (item) => [item.name]))).toEqual(["live news"])
  })

  it("keeps ties in the order they came in", () => {
    const tied = [{ name: "alpha one" }, { name: "alpha two" }]
    expect(names(rankBySearch(tied, "alpha", (item) => [item.name]))).toEqual([
      "alpha one",
      "alpha two",
    ])
  })

  it("is a no-op while the query is empty", () => {
    expect(rankBySearch(items, "   ", (item) => [item.name])).toBe(items)
  })
})
