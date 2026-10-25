/**
 * Token-anchored, typo-tolerant search.
 *
 * A query is a bag of words and a candidate is a bag of tokens — the maximal
 * runs of letters and digits in its fields. A word and a token relate in a
 * fixed order of quality:
 *
 *   1.00  the same token                       `sport` → `sport`
 *   0.90+ a token the word starts              `euros` → `eurosport`
 *   0.60+ the word sits inside a token (≥3 letters)  `sport` → `eurosport`
 *   0.45  the same token once look-alike glyphs are merged  `fl` → `f1`
 *   0.90·(1 − distance/length) a typo within the distance a word that long
 *         deserves (0 up to two letters, 1 up to five, 2 beyond — the
 *         thresholds Elasticsearch's `fuzziness: AUTO` uses)  `spprt` → `sport`
 *
 * Everything below "the same token" is discounted in proportion to what is
 * missing, so a typo is tolerated but never beats the literal match.
 *
 * Relevance is then decided in two steps:
 *
 *   1. admission — the words a title answers must carry the majority of the
 *      query's *informativeness* (BM25's idf, computed over the list in hand).
 *      A title that lacks one word, or answers only the rare ones, is still a
 *      match; a title leaning on `sport` in a sports catalog — or a bare `2`
 *      among numbered channels — is not. A word no title answers is ignored, so
 *      a half-typed word cannot empty the list.
 *   2. order — by coordination (how many words it answers), then quality (the
 *      mean relation over every word, an unanswered word scoring 0). A title
 *      answering more of the query leads; at equal coordination, the tighter
 *      match leads.
 *
 * This is the rule the previous character-run scorer lacked: it admitted any word
 * sharing two letters *anywhere* in the text, so "sky sport fl italy" kept 1,106
 * of 1,590 channel titles, 488 of which shared no whole word with the query at
 * all ("TVI Reality Portugal" rode in on "or"/"rt" shared with "sport"). A
 * relation here is a token-level match, so "TVI Reality Portugal" answers nothing
 * and is gone, while "Sky Sports F1 UK" — which merely lacks "italy" — stays,
 * below the title that answers every word.
 *
 * Ties are frequent — a score is a handful of relations, not a sum of run
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

/** How well one query word is answered by `tokens` — 0 when no token answers it. */
function bestRelation(word: string, tokens: readonly string[]): number {
  let best = 0
  for (const token of tokens) {
    const score = tokenScore(word, token)
    if (score > best) best = score
    if (best === 1) break
  }
  return best
}

/**
 * What each query word is worth for *admission*: BM25's idf, so a word the whole
 * list already shares — `sport` in a sports catalog, a bare `2` among numbered
 * channels — cannot admit a title on its own. Computed per query from the list
 * in hand; no index is kept.
 */
function wordWeights(frequency: readonly number[], documents: number): readonly number[] {
  const weights = frequency.map((seen) => Math.log(1 + (documents - seen + 0.5) / (seen + 0.5)))
  return weights.every((weight) => weight === 0) ? weights.map(() => 1) : weights
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
 * How well `text` answers `words` when it answers *all* of them — 0 when any
 * word is left unaccounted for, because such a text is only a partial match and
 * `rankBySearch` grades those separately.
 */
export function scoreMatch(text: string, words: readonly string[]): number {
  const tokens = textTokens(text)
  let total = 0
  for (const word of words) {
    const best = bestRelation(word, tokens)
    if (best === 0) return 0
    total += best
  }
  return words.length === 0 ? 0 : total / words.length
}

/**
 * Tokenized text per item, remembered per `fields` function: a live catalog is
 * ranked again on every keystroke, and re-normalizing twelve thousand rows each
 * time is what a phone cannot afford.
 */
const TOKENS = new WeakMap<object, WeakMap<object, { text: string; tokens: readonly string[] }>>()

function tokenized<T>(
  item: T,
  fields: (item: T) => readonly string[],
): { text: string; tokens: readonly string[] } {
  const text = normalize(fields(item).join(" "))
  if (typeof item !== "object" || item === null) {
    return { text, tokens: text.split(WORD_BOUNDARY).filter((token) => token !== "") }
  }
  let known = TOKENS.get(fields)
  if (known === undefined) {
    known = new WeakMap()
    TOKENS.set(fields, known)
  }
  const hit = known.get(item)
  if (hit !== undefined) return hit
  const made = { text, tokens: text.split(WORD_BOUNDARY).filter((token) => token !== "") }
  known.set(item, made)
  return made
}

/**
 * The `items` the query says something about, best match first. Admission is by
 * weight — a title must answer words carrying the majority of the query's
 * informativeness, so a near-miss that lacks one word (or answers only the rare
 * ones) stays, while a title leaning on a single ubiquitous word does not. Order
 * is by coordination (how many words it answers), then quality (the mean
 * relation), then the tighter title, the shorter one, and finally call order.
 * The empty query is a no-op, so a list keeps its own order until the user types.
 */
export function rankBySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
): readonly T[] {
  const words = queryWords(query)
  if (words.length === 0) return items
  const frequency = new Array<number>(words.length).fill(0)
  const held = items.map((item, order) => {
    const { text, tokens } = tokenized(item, fields)
    const bests = words.map((word) => bestRelation(word, tokens))
    bests.forEach((best, index) => {
      if (best > 0) frequency[index] = (frequency[index] ?? 0) + 1
    })
    return { item, bests, tokens: tokens.length, length: text.length, order }
  })
  const weights = wordWeights(frequency, items.length)
  // A word no title answers is not weighed: a half-typed word cannot veto every
  // candidate by demanding company nobody has.
  const worth = weights.reduce((sum, weight, index) => ((frequency[index] ?? 0) > 0 ? sum + weight : sum), 0)
  const ranked = held
    .map((entry) => {
      let answered = 0
      let gained = 0
      let quality = 0
      entry.bests.forEach((best, index) => {
        if (best > 0) {
          answered++
          gained += weights[index] ?? 1
        }
        quality += best
      })
      return { ...entry, answered, gained, score: quality / words.length }
    })
    .filter((entry) => entry.gained * 2 > worth)
  ranked.sort(
    (left, right) =>
      right.answered - left.answered ||
      right.score - left.score ||
      left.tokens - left.answered - (right.tokens - right.answered) ||
      left.length - right.length ||
      left.order - right.order,
  )
  return ranked.map((entry) => entry.item)
}
