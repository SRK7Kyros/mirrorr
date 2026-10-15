import { describe, expect, it } from "vitest"
import { queryWords, rankBySearch, scoreMatch } from "./search"

/**
 * The shape of the catalog the report was filed against, in its own order: half
 * the rows are "Sky Sport …" (so `sky` and `sport` answer almost everything and
 * carry little weight on their own) and the distinctive words — `f1`, `italy` —
 * are rare. A fixture of one title cannot show this: informativeness is a
 * property of the list.
 */
const SPELLING = [
  "Sky Sport 258 Italia",
  "Sky Sport 3 NZ",
  "Sky Sport 4 NZ",
  "Sky Sport F1 Italy",
  "Sky Sport Premier League DE",
  "Sky Sport Tennis Italy",
  "Sky Sports Golf DE",
  "Sky Sports Main Event",
  "Sky Sports Tennis UK",
  "Sky Sports+ Plus",
  "Sky Sports F1 UK",
  "Sky Sports F1 DE",
  "F1 DE Stream",
  "AppleTV F1",
  "DAZN F1 ES",
  "F1 Italy",
  "Eurosport 1",
  "Rai Sport Italy",
  "TVI Reality Portugal",
  "beIN Sports 1",
]

const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name)
const rank = (titles: readonly string[], query: string) =>
  rankBySearch(titles.map((name) => ({ name })), query, (item) => [item.name]).map((item) => item.name)

describe("queryWords", () => {
  it("lowercases, strips diacritics and splits on anything that is not a letter or digit", () => {
    expect(queryWords("Live  Sport!")).toEqual(["live", "sport"])
    expect(queryWords("dvr_hls #101")).toEqual(["dvr", "hls", "101"])
    expect(queryWords("Sky Spört")).toEqual(["sky", "sport"])
  })

  it("drops repeats and empties", () => {
    expect(queryWords("live live  ")).toEqual(["live"])
    expect(queryWords("   ")).toEqual([])
  })
})

describe("scoreMatch", () => {
  it("scores every word of the query, whatever the order", () => {
    expect(scoreMatch("sport italy", ["sport", "italy"])).toBe(1)
    expect(scoreMatch("sport italy", ["italy", "sport"])).toBe(scoreMatch("sport italy", ["sport", "italy"]))
  })

  it("answers nothing when a word is left unaccounted for", () => {
    expect(scoreMatch("live news", ["zzz", "news"])).toBe(0)
    expect(scoreMatch("live news", ["news"])).toBe(1)
  })

  it("ranks a whole token above a token the word merely starts or sits inside", () => {
    const whole = scoreMatch("sport", ["sport"])
    const starts = scoreMatch("eurosport", ["euros"])
    const inside = scoreMatch("eurosport", ["sport"])
    expect(whole).toBeGreaterThan(starts)
    expect(starts).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(0)
  })

  it("tolerates a typo, a transposition and a missing diacritic, below the literal match", () => {
    expect(scoreMatch("sport", ["spott"])).toBeGreaterThan(0)
    expect(scoreMatch("sport", ["sprot"])).toBeGreaterThan(0)
    expect(scoreMatch("sport", ["spott"])).toBeLessThan(1)
    expect(scoreMatch("Sky Spört", ["sport"])).toBe(1)
  })

  it("tolerates a typo only as far as the word's length deserves", () => {
    // Two letters get no latitude at all, up to five get one edit, longer gets two.
    expect(scoreMatch("f1", ["zz"])).toBe(0)
    expect(scoreMatch("tenis", ["tennis"])).toBeGreaterThan(0)
    expect(scoreMatch("tennis", ["tnis"])).toBe(0)
    expect(scoreMatch("sportklub", ["sporklub"])).toBeGreaterThan(0)
  })

  it("treats look-alike glyphs as the same word, never as the same score", () => {
    expect(scoreMatch("f1", ["fl"])).toBeGreaterThan(0)
    expect(scoreMatch("f1", ["fl"])).toBeLessThan(scoreMatch("f1", ["f1"]))
    expect(scoreMatch("o2", ["02"])).toBeGreaterThan(0)
  })

  it("does not reach across tokens for a word", () => {
    // The old scorer found "or"/"rt" inside "Portugal" and called that a match.
    expect(scoreMatch("TVI Reality Portugal", ["sport"])).toBe(0)
    expect(scoreMatch("1TV Ukraine", queryWords("sky sport fl italy"))).toBe(0)
  })
})

describe("rankBySearch", () => {
  it("is a no-op while the query is empty", () => {
    const items = [{ name: "live news" }, { name: "static" }]
    expect(rankBySearch(items, "   ", (item) => [item.name])).toBe(items)
  })

  it("drops every title the query has nothing to say about", () => {
    expect(rank(["dfdfslfsfs", "Brazzers", "Sky Sport F1 Italy"], "dfdfslfsfs")).toEqual(["dfdfslfsfs"])
    expect(rank(["Brazzers"], "zz")).toEqual([])
    expect(rank(["qq"], "qq")).toEqual(["qq"])
  })

  it("leads with the exact match", () => {
    // The report: "sky sport fl italy" put "Sky Sport 258 Italia" first, three
    // rows above "Sky Sport F1 Italy". The F1 row answers every word and leads.
    expect(rank(SPELLING, "sky sport fl italy")[0]).toBe("Sky Sport F1 Italy")
    expect(rank(SPELLING, "sky sport f1 italy")[0]).toBe("Sky Sport F1 Italy")
  })

  it("keeps the near-misses the query is still mostly about", () => {
    // "the user might also want those": a Sky Sports F1 of another region lacks
    // only "italy", and "F1 Italy" answers only the two distinctive words — both
    // stay, below the title that answers everything.
    const ranked = rank(SPELLING, "sky sport fl italy")
    expect(ranked[0]).toBe("Sky Sport F1 Italy")
    expect(ranked).toContain("Sky Sports F1 UK")
    expect(ranked).toContain("Sky Sports F1 DE")
    expect(ranked).toContain("Sky Sport Tennis Italy")
    expect(ranked).toContain("F1 Italy")
  })

  it("holds a word to the edit budget its own length deserves", () => {
    // "italy" is five letters, so AUTO allows one edit: a title carrying the
    // literal "Italy" answers it, but "Italia" — two edits away — does not.
    expect(rank(["Sky Sport 24 Italy", "Sky Sport 258 Italia"], "sky sport fl italy")).toEqual([
      "Sky Sport 24 Italy",
    ])
  })

  it("drops a title leaning only on words the query's own catalog is full of", () => {
    // "Sky Sport 3 NZ" answers "sky" and "sport" — the two words half the titles
    // already hold — and is not a match; nor is a title answering nothing.
    const ranked = rank(SPELLING, "sky sport fl italy")
    expect(ranked).not.toContain("Sky Sport 3 NZ")
    expect(ranked).not.toContain("Sky Sports Main Event")
    expect(ranked).not.toContain("TVI Reality Portugal")
    expect(ranked).not.toContain("Eurosport 1")
  })

  it("drops every title the query has nothing to say about", () => {
    expect(rank(["dfdfslfsfs", "Brazzers", "Sky Sport F1 Italy"], "dfdfslfsfs")).toEqual(["dfdfslfsfs"])
    expect(rank(["Brazzers"], "zz")).toEqual([])
    expect(rank(["qq"], "qq")).toEqual(["qq"])
  })

  it("puts a literal match above the typo that answers the same word", () => {
    expect(rank(["Sky Sports Golf DE", "Sky Sport Golf DE"], "sky sport golf de")).toEqual([
      "Sky Sport Golf DE",
      "Sky Sports Golf DE",
    ])
  })

  it("does not let a neighbour ride along on a shared number", () => {
    // "10" answers "sportklub" but not "2"; a title has to answer the query, not
    // just share one of its words with half the catalog.
    expect(rank(["Sportklub 10 Croatia", "Sportklub 2 Croatia"], "sportklub 2")).toEqual([
      "Sportklub 2 Croatia",
    ])
  })

  it("finds a word typed short, inside a longer token", () => {
    expect(rank(["Eurosport 1 Italy", "Sky Sports F1"], "euro")).toEqual(["Eurosport 1 Italy"])
  })

  it("prefers the tighter title, then the shorter one, then the order it came in", () => {
    const loose = { name: "Sky Sport F1 Italy — Link - 1" }
    const tight = { name: "Sky Sport F1 Italy" }
    const other = { name: "Sky Sport F1 Italy HD" }
    expect(names(rankBySearch([loose, tight, other], "sky sport f1 italy", (item) => [item.name]))).toEqual([
      "Sky Sport F1 Italy",
      "Sky Sport F1 Italy HD",
      "Sky Sport F1 Italy — Link - 1",
    ])
  })

  it("matches across every field it is handed", () => {
    const rows = [
      { name: "F1 Weekend", engine: "Streamlink" },
      { name: "F1 Weekend", engine: "yt-dlp" },
    ]
    const found = rankBySearch(rows, "f1 yt", (row) => [row.name, row.engine])
    // Only the yt-dlp row answers "yt"; the other answers "f1" alone, which is
    // not enough of this two-word query.
    expect(found).toHaveLength(1)
    expect(found[0]?.engine).toBe("yt-dlp")
  })

  it("puts the intended title first for every query in the laid-out set", () => {
    // A judgment set: the title a user typing this is after. Measured as mean
    // reciprocal rank — 1.0 means every intended title led its own query.
    const judgments: readonly (readonly [string, string])[] = [
      ["sky sport fl italy", "Sky Sport F1 Italy"],
      ["sky sport 4 nz", "Sky Sport 4 NZ"],
      ["sky sport tennis italy", "Sky Sport Tennis Italy"],
      ["sky sport premiere league de", "Sky Sport Premier League DE"],
      ["sky sports main event", "Sky Sports Main Event"],
      ["sky sportz golf de", "Sky Sports Golf DE"],
    ]
    const reciprocalRanks = judgments.map(([query, intended]) => {
      const position = rank(SPELLING, query).indexOf(intended)
      return position === -1 ? 0 : 1 / (position + 1)
    })
    expect(reciprocalRanks).toEqual(judgments.map(() => 1))
  })
})
