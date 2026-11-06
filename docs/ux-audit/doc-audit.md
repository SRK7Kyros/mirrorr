# Documentation audit — what still governs the redesign, what is dead

Date: **5 Nov 2026**. Scope: every `.md` under `docs/` (4,000 lines across 6 documents) plus the
stale planning artefacts under `.omo/drafts/` and `.omo/plans/`.

Question asked: *do these contradict the new plan, or are they simply outdated compared to the
running app?* Answer: **both, in different proportions per document.** Two of them describe a UI
that has never existed, one is a build prompt for a toolchain that was never used, one is the
backend contract and must not be treated as design guidance at all, and one is a month-old
deliberate decision that the new plan accidentally proposes to undo.

---

## 0. The rule this document establishes

> **A document is authoritative only for the layer it owns, and only until a dated override says
> otherwise.** Backend behaviour → `general-client-specification.md` and `mirrorr-core` source.
> Structure, layout and interaction → `plan.md` §2. Visual language → `mirrorr-web/src/ui/styles/tokens.css`.
> Nothing else is law.

Everything below follows from that. Where a doc and the running app disagree, **the app wins on
what exists**, and the plan wins on **what should exist** — but only after the doc is marked, or
the next agent will implement the doc.

---

## 1. Verdict per document

| Doc | Lines | Verdict | Why |
|---|---|---|---|
| `docs/console-design-spec.md` | 1,233 | **Split: behaviour kept, visual + structural void** | Describes a **light** glass system (`#FFFFFF` surface, `#1856FF` blue, Plus Jakarta Sans) that never shipped. Shipped app is **dark** (`--bg:#0a0a0c`, `--accent:#00e676`). Its §5 row/table anatomy and §3/§7 nav model are superseded. Its §1.4 status bindings, §6 state matrices and hazard rules are still the best record in the repo. |
| `docs/lovable-handoff-spec.md` | 814 | **Dead** | A prompt for building the console from scratch in Lovable.dev, using React Router and the same light tokens. The app exists, on TanStack Router + Tailwind v4 + shadcn. Nothing here is implementable; its §7 screens are all "table + instrument plates". |
| `docs/general-client-specification.md` | 1,058 | **Authoritative for the API, stale on fields, never design guidance** | Correct layer (transport, endpoints, wire contract) and the one doc the UI must not contradict. But its `AutorunResponse`/`SessionResponse` field lists are missing fields the web already consumes. Its own header says it "deliberately does NOT prescribe UX/UI" — so it can never be cited for layout. |
| `docs/resolver-sources-and-discovery.md` | 404 | **Core valid, §6 naming/structure dated** | Data model, plugin contract and API are current and implemented. §6.2 records that the **Profiles\|Sources tab switcher was deliberately deleted on 8 Oct 2026** in favour of two stacked sections — which the new plan proposes to reintroduce. |
| `docs/search-ranking.md` | 211 | **Current** | A measurement record for `rankBySearch`. No layout claims. Only stale token: it calls the panels "Presets". |
| `docs/shadcn-tailwind-migration-audit.md` | 280 | **Historical** | Its own §7 says the migration is complete (52/52 zero-diff). Its §0 still reads "audit + POC in progress", which is false and would restart a settled argument. |
| `docs/ux-audit/{framework,inventory,findings,plan}.md` | 834 | **Current, two defects fixed** | Written this week. `framework.md` rule 11 ("rows/lists beat billboards") is the rule that produced the wrong table recommendation; it is amended below. |

### Stale artefacts (not `docs/`, but they will be found and trusted)

| Path | State | Risk |
|---|---|---|
| `.omo/drafts/greenfield-web-ui-spec.md` | awaiting-approval, 13.1 KB | Already named as a "conflicting predecessor" by the shadcn audit. Proposes Tailwind without shadcn. |
| `.omo/drafts/mirrorr-ui-remake.md` | plan-written, review-in-flight | The other conflicting predecessor; "keep shadcn/ui primitives". |
| `.omo/drafts/web-frontend-implementation.md` | drafting | A plan to implement a UI that now exists. |
| `.omo/plans/{greenfield-web-ui-spec,mirrorr-ui-remake,web-frontend-implementation}.md` | —— | Executable plans for work already done. |
| `.omo/drafts/{mirrorr-capacitor-app,mirrorr-mobile-ui}.md` | interview / approved-ready | Capacitor wrapper is real and in use; treat as context, not as a task list. |

These are the actual trap: a fresh agent greps `.omo/plans/`, finds a greenfield UI plan, and
rebuilds what we are about to refactor. **Recommendation:** move the five `.omo/drafts/*` and the
three superseded `.omo/plans/*` into `.omo/archive/` — not deleted, since they are the record of
how the current app was decided. Awaiting your OK, because they are your planning artefacts.

---

## 2. The contradictions, explicitly

### C1 · The "design language" in the docs is not the design language of the app — **highest impact**

You asked to keep the design language and throw out the structure. The problem: the design
language in `console-design-spec.md` §1 and `lovable-handoff-spec.md` §6 is a **light, frosted
white** system.

| | Docs say | App ships |
|---|---|---|
| Surface | `--color-surface: #FFFFFF` (spec §1.1) | `--bg: #0a0a0c`, `--surface-1: #121216` (`tokens.css:13-15`) |
| Text | `--color-text: #141414` | `--text: #ededf0` |
| Accent | `primary #1856FF` (blue) | `--accent: #00e676` (mint) |
| Chrome | acrylic white `rgba(255,255,255,.55/.64/.72)` | solid dark surfaces, 1 px `--border` |
| Type | Plus Jakarta Sans, 16 px body | system UI stack, 13 px body, mono uppercase micro-labels |
| Depth | blue-tinted glass shadows, luminous edges | flat, border-led |

Those are two different products. The light glass deck **never shipped** — the console has been
dark "Control Room" since the Oct rebuild. So "keep the design language" must mean the *shipped*
one, i.e. `mirrorr-web/src/ui/styles/tokens.css`, not §1 of the spec.

**Consequence:** `console-design-spec.md` §0–§4 cannot be used as a style reference for this
refactor at all. The plan's §2.5 "tokens stay" now points at `tokens.css` instead.

### C2 · "No three equal cards" is a hard law in the spec, and the plan wants a 3-column equal grid

- `console-design-spec.md:25` — "*no three-equal-cards*" listed among the ten hard laws implemented literally.
- `console-design-spec.md:353` — the tally band is "*asymmetric acrylic cards … never three equal*".
- `console-design-spec.md:1225` — "*'three equal cards' cannot occur in either variant.*"

Plan §2.2a: **3 columns ≥1280, 300–400 px wide cards, one uniform height per surface** (decided
5 Nov 2026: masonry and variable heights were rejected — column-major packing breaks sort order and
tab order on a cursor-paginated list).

These cannot coexist, and an implementer reading both will not know which to obey. The law came
from a generic design brief about hero compositions; a repeated grid of N identical entities is
not that. **Resolution:** the law is superseded for *operational card grids* and survives for
*decorative bands* (which the plan deletes anyway). Recorded as an override in the spec.

### C3 · Nav model: the plan contradicts both the spec and the shipped app

| Width | Spec §3 / lovable §6.4 | App (`app-shell.tsx`, `sidebar.tsx`) | Plan §2.1 |
|---|---|---|---|
| ≥1280 | 240 px floating acrylic rail | `--sidebar-w`, solid, grouped nav | 236 px solid, labelled |
| 768–1279 | **72 px icon-only rail** | `max-lg` → `--sidebar-rail-w`, wordmark hidden | 200 px **labelled** — no icon rail |
| <768 | glass bottom tab bar, 5 items | `max-sm:block` + `BottomNav`, 4 items | bottom tabs |
| Grouping | flat list | **Record / Configure sections** (`nav-items.tsx:31-56`) | two groups |

The plan's tablet change is a real improvement (an icon rail at iPad width is what made your
screenshot feel cramped), but it is a **deliberate departure from the spec** and needs to be
recorded as such, not presented as "the shell". Also: neither doc knows about the nav sections,
which the app has and the mockups keep.

### C4 · Profiles + Sources — the plan proposes to undo a decision made on 8 Oct 2026

`resolver-sources-and-discovery.md:226`:

> "…two stacked `Section`s under one `Page title=\"Presets\"` (the Profiles\|Sources **tab switcher
> this view used to own was deleted Oct 8 2026**; the only kind toggle left is the one inside the
> create dialog)."

And the app matches: `profiles-view.tsx:240-242` renders `<Page title="Presets">` with
`<ProfilesPanel>` then `<SourcesPanel>`, no tabs.

Plan §4 and decision 3 recommend **"one page, two tabs"**. That reverts a month-old deliberate
removal and would look to you like the app going backwards. **My recommendation on decision 3 was
wrong**; it is corrected to: *keep two stacked sections, give the page one toolbar and one primary
action.* The audit finding (three competing CTAs, a `CONFIG {}` column) does not require tabs.

### C5 · Three names for one page

| Surface | Says |
|---|---|
| Shipped nav (`nav-items.tsx:38,50`) | `Autoruns`, `Presets` |
| Page title (`profiles-view.tsx:240`) | "Presets" |
| `console-design-spec.md` §5.8 | "Profiles", with a "New preset" FAB |
| `plan.md` §2.4 | "Scheduled recordings" (nav: `Scheduled`), "Profiles"; Presets and Autoruns leave the UI — **superseded 5 Nov 2026**: decision 2B chose `Autoruns`, so nav and page title now agree. The table records the state at audit time. |

The plan should win here — it is a decision, not a defect — but a rename is only real when nav,
page title, dialog title, search placeholders, the e2e specs and three docs change in the same
commit. Half a rename is worse than none.

### C6 · `general-client-specification.md` is missing fields the app already reads

`general-client-specification.md:209` lists `AutorunResponse` as 15 fields. `schemas.py:258-283`
also returns `orphan_policy`, `fallback_chain`, `fallback_profile_names`, **`issue`**,
`engine_name`, `resolver_name`, `profile_name`, **`next_run_at`**, `last_run_at`.

Same for `SessionResponse` (`schemas.py`) — `engine_name`, `resolver_name`, `profile_name`,
`autorun_name`, `recording_progress` are absent from the doc's shape at :175.

This is not cosmetic: `next_run_at` is where the card's countdown comes from, and `issue` is what
drives "Needs attention" (`src/api/domain/autorun-issue.ts:29`). An agent building from the doc
would ship a card with no countdown and no warning state.

### C7 · `framework.md` rule 11 is why the first plan said "make them tables"

> "**Scannability** — rows/lists beat billboards for dense operational data."

True and useful, but it was applied without the exception that makes cards legitimate. Amended:
rows win when the user is **comparing many heterogeneous fields**; cards win when each item is a
**reusable object with one headline number** (a run's elapsed time, a schedule's countdown). The
audit's own findings never said the *grid* was wrong — the blank 16:9 box was.

`framework.md:40` also still calls `console-design-spec.md` §5 "intent, not law" — §5 is now
superseded outright, so that pointer must point at `plan.md` §2 instead.

---

## 3. What each document still owns (the salvage list)

Nothing is being thrown away wholesale. This is what remains authoritative:

**`console-design-spec.md`**
- §1.4 — the nine-status → token binding table. The single best artefact in the repo; the plan's
  `deriveRunState()` is built on it.
- §5.4, §5.5, §5.6 — the *behavioural* half: `ChainEditor` semantics (rungs as patches, one
  source face at a time, collapsed-by-default), the locked hazards on a live schedule ("changes
  affect a future run"), "Run now" being client sugar with no server endpoint, the delete-while-
  remuxing rule, the duplicate-`snake_case_name` and tz-422 messages.
- §5.10–§5.14 — import/export collision handling, settings, per-item access editor (the crown/
  badge/`data-owns-escape` contract is pinned by tests; do not redesign it).
- §6 — component state matrices, and §8's measured contrast tables.

**`general-client-specification.md`** — everything, as the API contract. Read it before any form
or endpoint work. Just never for layout.

**`resolver-sources-and-discovery.md`** — §3 data model, §4 plugin contract (`config_schema`,
discovery capability), §5 API, §6.3 discovery panel behaviour, §6.5 the one-dialog-two-kinds rule.
Only the page title ("Presets") and the section-stacking decision are touched by the plan.

**`search-ranking.md`** — `rankBySearch` is frozen. The plan does not touch it; only a rename.

**`shadcn-tailwind-migration-audit.md`** — one useful thing survives: the measurement contract
(§1) that "fidelity is only definable once baselines exist". That is plan P0.

---

## 4. Changed in this pass (docs only, no code)

| File | Change |
|---|---|
| `docs/console-design-spec.md` | Dated **design-language override** at §0: the shipped dark tokens are law; §1.1–§4 describe a light system that did not ship. `no-three-equal-cards` marked superseded for operational grids. |
| `docs/lovable-handoff-spec.md` | Dated banner: dead for implementation; kept only as a feature checklist. |
| `docs/general-client-specification.md` | Dated banner: field drift (autorun `issue`/`next_run_at` etc.), `schemas.py` wins; explicit "not a design document". |
| `docs/shadcn-tailwind-migration-audit.md` | Dated banner: migration complete, historical record. |
| `docs/resolver-sources-and-discovery.md` | Dated banner: §6.2's tab-removal decision stands; the plan restores two stacked sections, not tabs. |
| `docs/ux-audit/framework.md` | Rule 11 amended with the cards-vs-rows test; :40 pointer moved to `plan.md` §2. |
| `docs/ux-audit/plan.md` | Decision 3 recommendation corrected to "stacked sections, one toolbar"; new §0.1 sources-of-truth table. |

---

## 5. What this changes about the plan

Only one substantive thing, and it is the answer I got wrong:

- **Decision 3 → now A′ (recommended): keep the two stacked sections; give the page one toolbar,
  one primary action and one count.** Not tabs (they were removed on purpose), not two routes
  (Sources has no independent job).

Everything else stands, but read it with the corrected layer map: structure from `plan.md`,
behaviour from the spec's §5.4–§5.14, API from `general-client-specification.md`, colour and type
from `tokens.css`, statuses from spec §1.4.

The five remaining decisions (1, 2, 4, 5, 6) are unchanged.
