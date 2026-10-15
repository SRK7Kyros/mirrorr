# Search ranking — the field, the failure, and the design

`mirrorr-web/src/api/domain/search.ts`. Its `rankBySearch` is the single ranker behind
four inputs: the sessions list, the autoruns list, the Presets panels (profiles and
sources), and the resolver discovery browser. This document records what the field
does, what the previous scorer got wrong, what replaced it, and how it was measured.

## 1. What was wrong

The previous scorer treated the query as a bag of words and matched each word against
the *whole* candidate text as character-level "shared runs" — the runs a diff tool
finds, each worth its length squared, scaled by the fraction of the word's characters
that landed. A word it lacked only lowered the score; it never excluded.

Three consequences, all measured on the live daddylive catalog (1,590 channel + event
titles):

| Symptom | Measurement |
|---|---|
| Junk admitted | `"sky sport fl italy"` kept **1,106 of 1,590** rows; **488** of them shared no whole word with the query. `"TVI Reality Portugal"` rode in on the `or`/`rt` runs inside *Portugal* matching the `sport` word. |
| Junk outranking | `"dfdfslfsfs"` — pure noise — returned **44** rows. `"zz"` returned *Brazzers*. |
| Counterintuitive order | Every score was a sum of run lengths, so near-misses tied constantly and ties fell back to catalog order. `"sportklub 2"` did rank `Sportklub 2 Croatia` first (82) but only just, above `Sportklub 10 Croatia` (81) — a shared `1`. For `"sky sport fl italy"`, `Sky Sport 258 Italia` (46.8) sat above `Sky Sport F1 Italy` (59) in the *rendered* list, because the tie-free ordering was never reached. |

## 2. What the field does

**The one distinction that organises it all:** every matcher splits into *matching*
(is a candidate eligible?) and *scoring* (how do the eligible ones order?). Three
scoring formalisms dominate:

| Formalism | Examples | Cost |
|---|---|---|
| Greedy first-match + position bonuses | fzf V1, Sublime (`lib_fts`), command-t | O(n) amortised |
| Dynamic programming (affine-gap / Smith-Waterman) | fzy, fzf V2, skim, VS Code, fuzzaldrin-plus | O(n·m) |
| Bit-parallel / bounded edit distance | Fuse.js (Bitap), MiniSearch, Lucene/ES fuzzy | O(n·m/word) or O(k·n) |

**Interactive matchers are *subsequence* matchers.** fzy's own
[ALGORITHM.md](https://github.com/jhawthorn/fzy/blob/master/ALGORITHM.md) states the
split explicitly; all of them require the needle's characters to appear in order, gaps
allowed, and differ only in the recurrence that scores the alignment.

- **fzy** ([`match.c`](https://github.com/jhawthorn/fzy/blob/master/src/match.c),
  [`config.def.h`](https://github.com/jhawthorn/fzy/blob/master/src/config.def.h)):
  Gotoh-style affine-gap DP over `double`. Constants: `SCORE_MATCH_CONSECUTIVE 1.0`,
  `SCORE_MATCH_SLASH 0.9`, `SCORE_MATCH_WORD 0.8`, `SCORE_MATCH_CAPITAL 0.7`,
  `SCORE_MATCH_DOT 0.6`, `SCORE_GAP_LEADING/TRAILING -0.005`, `SCORE_GAP_INNER -0.01`,
  `SCORE_MAX ±Infinity`. Smallest surface of any of them, and IEEE-754 arithmetic makes
  it bit-identical across runtimes — the easiest faithful port.
- **fzf V2** ([`algo.go`](https://github.com/junegunn/fzf/blob/master/src/algo/algo.go)):
  modified Smith-Waterman. `scoreMatch 16`, `scoreGapStart -3`, `scoreGapExtension -1`,
  `bonusBoundary/NonWord 8`, `bonusCamel123 7`, `bonusConsecutive 4`,
  `bonusFirstCharMultiplier 2`. Integer (`int16`) semantics *are* part of the result
  (16-bit overflow guards). Ties break by `length,index` — fzf's default `--tiebreak
  length` ([man page](https://man.archlinux.org/man/fzf.1.en)) — which is the first hint
  of the right idea: **a shorter, tighter candidate should win a tie.**
- **skim** ([`skim.rs`](https://github.com/lotabout/skim/blob/master/src/fuzzy_matcher/skim.rs)):
  fzf's recurrence in Rust plus a `penalty_case_mismatch`.
- **Sublime / `lib_fts`**
  ([write-up](https://www.forrestthewoods.com/blog/reverse_engineering_sublime_texts_fuzzy_match/),
  [code](https://github.com/forrestthewoods/lib_fts)): recursive, depth-capped
  (`recursion_limit 10`), `SEQUENTIAL_BONUS 15`, `SEPARATOR_BONUS 30`, `CAMEL_BONUS 30`,
  `FIRST_LETTER_BONUS 15`, `LEADING_LETTER_PENALTY -5` (clamped -15),
  `UNMATCHED_LETTER_PENALTY -1` from a base of 100. The author documents the flaw that
  matters for titles: it can prefer an earlier contiguous run over a later, better
  CamelCase alignment. Also: *"scores can only be compared when they came from the same
  pattern"* — absolute scores don't compose across queries.
- **VS Code `fuzzyScore`**
  ([`filters.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/filters.ts)):
  pure-integer DP, `_maxLen 128`, per-cell weights `7/5` (prefix, camel, separator),
  `+1` contiguous, `-5` gap open, then `-1` per skipped character. **Not normalised to
  0..1.**
- **command-score** (cmdk; [source](https://github.com/superhuman/command-score/blob/master/index.js)):
  the normalised descendant — `SCORE_CONTINUE_MATCH 1`, `SPACE_WORD_JUMP 0.9`,
  `CHARACTER_JUMP 0.3`, `TRANSPOSITION 0.1`, multiplicative penalties
  (`PENALTY_SKIPPED 0.999`), arranged so a continuous match totals exactly 1.
- **fuzzysort**, **uFuzzy**, **Fuse.js** (Bitap, `MAX_BITS 32`, `threshold 0.6`),
  **MiniSearch** (Levenshtein over a radix tree:
  `maxDistance = min(maxFuzzy, round(term.length * fuzzy))`, default `fuzzy 0.2`),
  **RapidFuzz** ([`fuzz_py.py`](https://github.com/maxbachmann/RapidFuzz/blob/main/src/rapidfuzz/fuzz_py.py)).
  RapidFuzz's documented trap: `token_set_ratio` returns **100 for a subset match**, which
  is disqualifying for ranking.

**Classic similarity families and where short strings break them:**

- Levenshtein / Damerau-Levenshtein — the right measure for a *word*, useless for a
  whole *title* (a 30-character title is never within distance 2 of a query).
- Jaro/Jaro-Winkler — tuned for names, rewards a shared prefix; not rank-composable.
- Sørensen-Dice / trigram Jaccard — what `pg_trgm` uses
  ([docs](https://www.postgresql.org/docs/current/pgtrgm.html)) and what SQLite's FTS5
  `trigram` tokenizer indexes ([docs](https://sqlite.org/fts5.html#the_trigram_tokenizer));
  good for *admission*, blind to order, and a 2-gram set on a 4-word query admits
  everything (this is close to the failure we had).

**Typo tolerance in production:**

- Elasticsearch `fuzziness: AUTO` defaults to **`AUTO:3,6`** — 0 edits for terms of 1–2
  characters, 1 for 3–5, 2 beyond ([common options](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/common-options)).
  `prefix_length 0`, `max_expansions 50`, `transpositions true`.
- Lucene caps `MAXIMUM_SUPPORTED_DISTANCE = 2` and builds a Schulz–Mihov parametric
  Levenshtein automaton ([`LevenshteinAutomata.java`](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/util/automaton/LevenshteinAutomata.java));
  at distance 2 that is up to `30 × (word length + 1)` states, decoded from packed bit
  arrays. Not worth porting for a short needle scanned against many candidates.
- Ranking after expansion is BM25 (`k1 1.2`, `b 0.75`, `idf = ln(1 + (N − n + 0.5)/(n + 0.5))`,
  [source](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/search/similarities/BM25Similarity.java)).

**How production systems keep junk out** — the three patterns that matter here:
AND semantics (`minimum_should_match`, i.e. *every* query term must match something, not
just one), IDF/stopword weighting so a ubiquitous word creates no match on its own, and
relative cutoffs (`score ≥ best × k`).

**How to score a ranker offline:** MAP, MRR (`1/rank(first relevant)`), nDCG
(`Σ rel_i / log2(i+1)`, normalised by the ideal), and precision@k of the head.

## 3. The design

The corpus is ~1,600 short titles, ranked client-side on every keystroke, identical in
every browser and testable in bun. That rules out anything needing a *persistent* index
(MiniSearch's radix tree, FTS5's tables), anything position/threshold-shaped (Bitap's
`location`/`distance`), and the parametric automaton (state explosion for a needle scanned
per candidate). BM25 itself is not ruled out — only its *index* is: its idf is a statistic
over the list in hand, so it is computed per query on the pass that is already happening.
Pure *subsequence* matchers — fzf, fzy, VS Code, Sublime — are also out as the primary: they
have **no typo tolerance at all** (a misspelled letter simply fails to match), and our
reported failure was precisely a spelling-adjacent case (`fl` for `f1`).

What replaced it: **token-anchored matching with a bounded edit distance**, i.e. the
field's *admission* discipline (word-anchored matching, weighted like BM25) married to the
field's *typo budget* (ES `AUTO:3,6`), and fzf's `--tiebreak length` idea for ordering.

1. **Normalise** — NFD, strip combining marks, lowercase. `Sky Spört` and `SKY SPORT`
   compare equal, and length arithmetic happens after folding so indices never drift.
2. **Tokenise** — split on anything that is not a letter or digit. A query word is matched
   against *tokens*, never against arbitrary substrings spanning a token boundary (this
   alone kills `sport` ↛ *Portugal*).
3. **Relate** each word to its best token, in a fixed order of quality:

   | Relation | Value |
   |---|---|
   | the same token | `1` |
   | a token the word starts | `0.9 + 0.1·len(word)/len(token)` |
   | a token the word sits inside (word ≥ 3) | `0.6 + 0.4·len(word)/len(token)` |
   | the same token after merging look-alike glyphs | `0.45` |
   | a typo within `maxDistance(len)` | `0.9·(1 − distance/max(len))` |

   `maxDistance` is `AUTO`'s rule: 0 up to two letters, 1 up to five, 2 beyond. The
   distance is Damerau-Levenshtein (a transposition is one edit) over two rows, abandoned
   as soon as a row exceeds the limit; it runs on the look-alike-folded forms so `fl`/`f1`
   is caught inside longer words too. Everything below the literal match is discounted in
   proportion to what is missing, so **a typo is tolerated but can never beat the word it
   misspells.**
4. **Weigh** each query word by its informativeness across the list in hand — BM25's
   `idf = ln(1 + (N − n + 0.5)/(n + 0.5))`, `n` the titles answering that word. No index is
   built or kept: the list is already being walked, so the counts come free on the same
   pass. A word *no* title answers is left out of the weighing, so a half-typed word cannot
   empty the list.
5. **Admit** a title when the words it answers carry the **majority of the query's
   informativeness**. This is the step that both keeps the near-misses and shuts out the
   noise: `Sky Sports F1 UK` lacks only `italy` and stays, `F1 Italy` answers only the two
   rare words and stays, while `Sky Sport 3 NZ` (only `sky` and `sport`, which half the
   catalog holds) and `RTE 2` (only the ubiquitous `2`) do not. Note the shape: a 2-word
   query needs both words, because their weights *are* the whole query — the tolerance
   grows with how much of the query is distinctive.
6. **Order** by coordination (how many words answered), then the mean relation, then the
   tighter title (fewer tokens unaccounted for), then the shorter title, then call order.
   Coordination first is what keeps the reported case intuitive: the title answering all
   four words leads, and the titles answering three or two follow it.

The look-alike groups (`1 l |`, `0 o`) exist for exactly the reported case: `fl` for `f1`.
They are only ever *tried*, and a folded match scores `0.45` against the literal `1`, so
`Sky Sport F1 Italy` beats a hypothetical `Sky Sport FL Italy` for `f1`.

### Measured, on the live 1,590-title catalog

| Query | Before | After |
|---|---|---|
| `sky sport fl italy` | 1,106 survivors; `Sky Sport 258 Italia` rendered first | **30** survivors, led by `Sky Sport F1 Italy`, then the other `Sky Sport … Italy` channels, then `Sky Sports F1` / `4K` / `DE` / `UK`, with `F1 Italy` last — every near-miss the report named is present |
| `dfdfslfsfs` | 44 survivors (0.8 each) | **0** |
| `zz` | 1 (*Brazzers*) | **0** |
| `sportklub 2` | 991 survivors; `Sportklub 10 Croatia` at 81 vs 82 | **7** — `Sportklub 2 Croatia` first, then 3/5/7/8/9/10; `RTE 2` (the digit alone) excluded |
| `euro sport italy` | 1,110 survivors | **27** — `EuroSport 1 Italy`, `EuroSport 2 Italy` first, then the other-Italy and other-region EuroSport rows |
| `nba` | 79 survivors, exact matches tied with `WNBA` | **12** — exact `NBA` rows first, `WNBA` at 0.900 |
| `bein arabic` | — | **14** — `Bein Arabic Baclup` first, then the `beIN Sports … Arabic` rows |
| `tvi reality` | — | **2** — `TVI Reality Portugal`, then `RealityKings` |
| `TVI Reality Portugal` on `sky sport fl italy` | survived | **excluded** |
| exact-title query | rank 1 but tied with 8 neighbours; one case at rank 0 | **rank 1** in every case of the unit-test judgment set (MRR 1.0) |

Typo tolerance is retained, not traded away: `sprot` still finds 259 title rows (all at
0.720 — below any literal `sport`). The one place the `AUTO` budget bites is a spelling two
edits from a five-letter word: `Sky Sport 258 Italia` is not a match for `italy` (that is
`Italia`, two edits away). That is `AUTO`'s rule working as designed, and it is asserted in
the unit tests so it cannot drift silently.

Cost: **~5 ms** per keystroke for a one- or two-word query and **~20 ms** for a four-word
one over 1,590 items (bun on this host), dominated by per-item normalisation; the idf
weighing adds a counter to the pass already being made. No index, cache or precompute is
warranted.

## 4. Residual limits

- Weighting is **corpus-relative** — a statistic over the list being ranked, not a
  catalogue-wide constant. On a tiny list (a handful of rows) it has little to weigh, and
  ranking there is close to plain coordination + quality. That is the price of needing no
  index.
- Admission is a **weighted majority, not strict AND**. A 2-word query needs both words
  (their weights are the whole query); a 4-word query tolerates one miss. A query made
  mostly of very common words therefore stays broad — `sport` alone correctly returns 548
  rows, all of which contain it.
- Substring relations need a word of 3+ characters, so a two-letter query word matches
  whole tokens or token prefixes only. Two letters carry too little signal to justify
  anything looser.
- No synonyms, stemming or cross-language folding beyond diacritics; the corpus is proper
  nouns and numbers, where stemming does more harm than good.
