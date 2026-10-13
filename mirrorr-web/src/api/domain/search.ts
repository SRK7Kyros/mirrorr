/**
 * Order-agnostic, character-level search scoring.
 *
 * A query is a bag of words, and each word is matched against a candidate's
 * text as *groups* — the runs of characters the two share — never index by
 * index. Every word a candidate shares adds to its score, so a word it lacks
 * never excludes it; it only leaves it behind the candidates that do share it.
 *
 * A run is worth its length squared, so the same characters in one unbroken run
 * beat them broken apart by typos, and a longer run earns a bonus. A word is
 * then scaled by the share of its own characters that actually landed, so junk
 * a query carries costs it: "salamanleko" (one letter moved) keeps more of the
 * perfect score than "salamahadhasdahdahsleko" (a pile of junk in the middle),
 * even though both share exactly "salama" and "leko".
 */

const WORD_BOUNDARY = /[^\p{L}\p{N}]+/u

/** A shared run shorter than this is noise — unless the query word itself is. */
const MIN_GROUP = 2

/** The distinct, lowercased words of a query, e.g. `"Live  Sport!"` → `["live", "sport"]`. */
export function queryWords(query: string): readonly string[] {
  const words = query.toLowerCase().split(WORD_BOUNDARY).filter((word) => word !== "")
  return [...new Set(words)]
}

/**
 * The sizes of every run `word[fromWord:toWord]` and `text[fromText:toText]`
 * share, found the way diff tools find them: take the longest run, then the
 * longest on each side of it, and so on.
 */
function sharedGroups(
  word: string,
  text: string,
  fromWord: number,
  toWord: number,
  fromText: number,
  toText: number,
): readonly number[] {
  const sizes: number[] = []
  const pending: (readonly [number, number, number, number])[] = [
    [fromWord, toWord, fromText, toText],
  ]
  let frame = pending.pop()
  while (frame !== undefined) {
    const [wordLo, wordHi, textLo, textHi] = frame
    const width = textHi - textLo
    let previous = new Array<number>(width).fill(0)
    let size = 0
    let endInWord = 0
    let endInText = 0
    for (let i = wordLo; i < wordHi; i++) {
      const current = new Array<number>(width).fill(0)
      for (let j = textLo; j < textHi; j++) {
        if (word[i] !== text[j]) continue
        const run = (j > textLo ? previous[j - textLo - 1] : 0) + 1
        current[j - textLo] = run
        if (run > size) {
          size = run
          endInWord = i
          endInText = j
        }
      }
      previous = current
    }
    if (size > 0) {
      sizes.push(size)
      const startInWord = endInWord - size + 1
      const startInText = endInText - size + 1
      if (startInWord > wordLo && startInText > textLo) {
        pending.push([wordLo, startInWord, textLo, startInText])
      }
      if (endInWord + 1 < wordHi && endInText + 1 < textHi) {
        pending.push([endInWord + 1, wordHi, endInText + 1, textHi])
      }
    }
    frame = pending.pop()
  }
  return sizes
}

/** True when `word` and `text` share a run long enough to count as a group. */
function sharesGroup(word: string, text: string): boolean {
  const min = Math.min(MIN_GROUP, word.length)
  if (min <= 1) return text.includes(word)
  for (let i = 0; i + min <= word.length; i++) {
    if (text.includes(word.slice(i, i + min))) return true
  }
  return false
}

/**
 * What each of `words` shares with `text`, summed — a missing word adds nothing.
 * Sharing earns the runs (`length²` each); getting characters wrong costs, as
 * those runs are scaled by the share of the word's own characters that landed.
 */
export function scoreMatch(text: string, words: readonly string[]): number {
  const haystack = text.toLowerCase()
  let score = 0
  for (const word of words) {
    if (!sharesGroup(word, haystack)) continue
    const min = Math.min(MIN_GROUP, word.length)
    let matched = 0
    let runs = 0
    for (const size of sharedGroups(word, haystack, 0, word.length, 0, haystack.length)) {
      if (size < min) continue
      matched += size
      runs += size * size
    }
    score += (runs * matched) / Math.max(word.length, 1)
  }
  return score
}

/**
 * The `items` sharing anything with `query`, best match first. Items sharing
 * nothing are dropped; ties keep the order they came in. An empty query is a
 * no-op, so a list keeps its own order until the user types.
 */
export function rankBySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
): readonly T[] {
  const words = queryWords(query)
  if (words.length === 0) return items
  return items
    .map((item) => ({ item, score: scoreMatch(fields(item).join(" "), words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}
