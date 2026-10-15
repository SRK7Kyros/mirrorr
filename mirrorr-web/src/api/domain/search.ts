/**
 * Token-anchored, typo-tolerant search.
 *
 * A query is a bag of words and a candidate is a bag of tokens — the maximal
 * runs of letters and digits in its fields. Every word must find a token it
 * relates to; the candidate is dropped otherwise. That single rule is what the
 * previous character-run scorer lacked: it admitted any word sharing two
 * letters *anywhere* in the text, so "sky sport fl italy" kept 1,106 of 1,590
 * channel titles, 488 of which shared no whole word with the query at all
 * ("TVI Reality Portugal" rode in on "or"/"rt" shared with "sport"). Here
 * "TVI Reality Portugal" relates to nothing and is gone.
 *
 * A word and a token relate in a fixed order of quality:
 *
 *   1.00  the same token                       `sport` → `sport`
 *   0.90+ a token the word starts              `euros` → `eurosport`
 *   0.60+ a token the word sits inside         `sport` → `eurosport`
 *   0.45  the same token once look-alike glyphs are merged  `fl` → `f1`
 *   0.90·(1 − distance/length) a typo within the distance a word that long
 *         deserves (0 up to two letters, 1 up to five, 2 beyond — the
 *         thresholds Elasticsearch's `fuzziness: AUTO` uses)  `spprt` → `sport`
 *
 * Everything below "the same token" is discounted in proportion to what is
 * missing, so a typo is tolerated but never beats the literal match. A
 * candidate's score is the average of its words' best relations: the perfect
 * title scores 1, one word at arm's length drags it below that, and a candidate
 * admitted on an arm's-length relation alone can no longer outrank a tight one.
 *
 * Ties are frequent now — a score is a handful of relations, not a sum of run
 * lengths — so they fall, in order, to the tighter title (fewer tokens left
 * unaccounted for), then the shorter title, then the order the caller supplied.
 */

const WORD_BOUNDARY = /[^\p{L}\p{N}]+/u
const COMBINING_MARKS = /\p{M}+/gu

/**
 * Glyphs that read as one another in a channel list. The first member of each
 * group is the canonical form; folding is only ever *tried*, so a literal match
 * always outranks a folded one.
 */
const LOOKALIKES: readonly string[] = ["1l|", "0o"]
const LOOKALIKE_OF = new Map<string, string>(
  LOOKALIKES.flatMap((group) => [...group].map((glyph) => [glyph, group[0]] as const)),
)

/** The distance a typo in a word of `length` letters is allowed (AUTO, capped at 2). */
function maxDistance(length: number): number {
  if (length <= 2) return 0
  if (length <= 5) return 1
  return 2
}

/** Casefolded, diacritic-free form — `Sky Spört` and `SKY SPORT` compare equal. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase()
}

/** `normalize`d with look-alike glyphs merged. */
function fold(text: string): string {
  let folded = ""
  for (const glyph of text) folded += LOOKALIKE_OF.get(glyph) ?? glyph
  return folded
}

/**
 * Damerau-Levenshtein (adjacent transpositions count as one edit) over two
 * rows, abandoned as soon as every cell of a row exceeds `limit` — the cost
 * never decreases, so a word that long cannot rescue it.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let beforePrevious = new Array<number>(b.length + 1).fill(0)
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let best = i
    for (let j = 1; j <= b.length; j++) {
      let distance = Math.min(
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        previous[j] + 1,
        current[j - 1] + 1,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, beforePrevious[j - 2] + 1)
      }
      current[j] = distance
      if (distance < best) best = distance
    }
    if (best > limit) return limit + 1
    const spent = beforePrevious
    beforePrevious = previous
    previous = current
    current = spent
  }
  return previous[b.length]
}

/** How well one query word is answered by one token; 0 means "not at all". */
function tokenScore(word: string, token: string): number {
  if (token === word) return 1
  if (token.startsWith(word)) return 0.9 + (0.1 * word.length) / token.length
  if (word.length >= 3 && token.includes(word)) return 0.6 + (0.4 * word.length) / token.length
  const foldedWord = fold(word)
  const foldedToken = fold(token)
  if (foldedToken === foldedWord) return 0.45
  const limit = maxDistance(word.length)
  if (limit === 0) return 0
  const distance = editDistance(foldedWord, foldedToken, limit)
  if (distance > limit) return 0
  return (1 - distance / Math.max(word.length, token.length)) * 0.9
}

/** The distinct, normalized words of a query, e.g. `"Live  Sport!"` → `["live", "sport"]`. */
export function queryWords(query: string): readonly string[] {
  return [...new Set(normalize(query).split(WORD_BOUNDARY).filter((word) => word !== ""))]
}

/** The tokens of one text (fields joined), the unit a query word is matched against. */
function textTokens(text: string): readonly string[] {
  return normalize(text).split(WORD_BOUNDARY).filter((token) => token !== "")
}

/**
 * How well `text` answers `words`, averaged over the words — 0 when any word
 * answers nothing, because such a text is not a match at all.
 */
export function scoreMatch(text: string, words: readonly string[]): number {
  if (words.length === 0) return 0
  const tokens = textTokens(text)
  let total = 0
  for (const word of words) {
    let best = 0
    for (const token of tokens) {
      const score = tokenScore(word, token)
      if (score > best) best = score
      if (best === 1) break
    }
    if (best === 0) return 0
    total += best
  }
  return total / words.length
}

/**
 * The `items` every word of `query` can answer, best match first. A word answered
 * by nothing drops the item; the empty query is a no-op, so a list keeps its own
 * order until the user types.
 */
export function rankBySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
): readonly T[] {
  const words = queryWords(query)
  if (words.length === 0) return items
  const ranked: { item: T; score: number; loose: number; length: number; order: number }[] = []
  items.forEach((item, order) => {
    const text = normalize(fields(item).join(" "))
    const tokens = text.split(WORD_BOUNDARY).filter((token) => token !== "")
    let total = 0
    let answered = 0
    for (const word of words) {
      let best = 0
      for (const token of tokens) {
        const score = tokenScore(word, token)
        if (score > best) best = score
        if (best === 1) break
      }
      if (best === 0) return
      total += best
      answered++
    }
    ranked.push({ item, score: total / words.length, loose: tokens.length - answered, length: text.length, order })
  })
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.loose - right.loose ||
      left.length - right.length ||
      left.order - right.order,
  )
  return ranked.map((entry) => entry.item)
}
