# Feasibility audit — rebuild `mirrorr-web` on shadcn/ui + Tailwind CSS at ≥98% visual fidelity

Status: **audit + POC in progress.** Date: 2026-10-11 (rev. 2).
Rev. 2 corrects the shadcn theming/dark-mode stance (§4, §4.1, §7, §10); the POC runs on branch `poc/tailwind-shadcn`.
Supersedes the conflicting predecessors `.omo/drafts/greenfield-web-ui-spec.md` ("Tailwind, no shadcn") and
`.omo/drafts/mirrorr-ui-remake.md` ("keep shadcn/ui primitives").

---

## 0. Verdict up front

| Question | Answer |
|---|---|
| Is it technically feasible? | **Yes.** No hard blocker. Tailwind v4 + the Vite multi-entry build + Capacitor coexist cleanly. |
| Is ≥98% visual fidelity achievable? | **Yes — and re-skinning is shadcn's *intended* workflow, not a defect.** Its styling layer is deliberately provisional ("Open Code": *"This is not a component library. It is how you build your component library."*). The re-skin work equals what plain Tailwind demands anyway; shadcn removes **behaviour** work, not styling work. |
| Does the migration deliver the user's stated value (battle-tested safety + maintainability)? | **Yes, now that Tailwind is decided.** shadcn = Radix behaviour + your styling + `cva` composition, as source you own. It **dominates** Tailwind-alone (you would re-hand the Radix behaviour) and Radix-manual (you would re-hand the styling glue). Radix-only is cheaper for safety alone, but forfeits the maintainability goal. |
| Recommended shape | **Hybrid, incremental (§7 Shape B), with shadcn/ui as the vehicle:** Tailwind + shadcn/Radix as the engine, `tokens.css` stays canonical, retire the CSS file-by-file behind a pixel-diff gate. |
| Headline risk | Fidelity is **currently unmeasurable** — there is no visual-regression harness. Step 0 is building one; without it "98%" is unfalsifiable. |
| Rough effort | **≈ 56–109 dev-days** for a solo operator at 98% (see §8). The last 2% is the expensive tail. |

---

## 1. What "98% fidelity" must mean, and how to prove it

Right now the project **cannot** verify a fidelity claim:

- `playwright.config.ts` runs **route-mocked, behaviour-only** specs (7 files, ~673 lines), Chromium desktop, **no screenshot/trace assertions**. It asserts *that things work*, not *how they look*.
- Precedent exists for a visual harness: `.omo/evidence/f3-V3-*.png`, `f3-V4-{375,390x844,768,1280}.png` were captured during greenfield QA. That pattern is the template.

**Fidelity is only definable once baselines exist.** Measurement contract (build this *before* touching UI):

1. Full-route screenshot capture of the **current** app at **375 / 768 / 1280 / 1440**, dark (the only theme), Chromium.
2. Per-route **state matrix**: empty, loading (skeletons), populated, error/banner, dialog/drawer/menu open, selected/bulk rows, focus-visible.
3. Pixel-diff after migration with a per-surface tolerance budget and an explicit ignore-list (antialiasing, subpixel text, scrollbar, fonts).
4. `98%` = **≥98% of captured states within tolerance** *and* zero `HIGH`-severity diffs in the interaction register (§6).

Everything below assumes that harness exists. Without it, the honest target is "qualitatively faithful", not 98%.

---

## 2. Current surface, quantified

| Layer | Size |
|---|---|
| `src/ui/**/*.tsx` | **10,139 lines** |
| Components (`ui/components/`) | 34 real + 3 test files, **2,587 lines** |
| Views (`ui/views/`) | **38 files**, largest: autoruns 1,674L, profiles 1,486L, sessions 1,990L, import-export 677L |
| Chrome (`ui/chrome/`) | 14 files (shell, sidebar, topbar, bottom-nav, notification bell/drawer, breadcrumb, connection pill, health banner, page transition) |
| Styling | 5 files, **3,302 lines**: `components.css` 2,065 · `layout.css` 726 · `base.css` 215 · `fonts.css` 153 · `tokens.css` 143 |
| Design tokens | **98** CSS custom properties, one `:root`, dark only |
| Class selectors | **267**; **71 used only in views** (composite patterns: `session-card*`, `entity-card*`, `discovery-card*`, `page-head`, `toolbar`, `table-desktop`/`cards-mobile`, `stat-grid`, `url-list*`) |
| Call sites | **510** `className=`, **46** `cn(` |
| Motion | `ui/lib/motion.ts` (105L) JS mirror of the CSS motion tokens + named variants; **30** `motion.*` uses; **6** `@keyframes` |
| A11y/bespoke plumbing | 129 `aria-*`, 29 `data-*`, 4 `createPortal`, custom `overlay-stack.ts` (14L) |
| Runtime deps (UI) | **none** — no Radix, no cva, no clsx, no tailwind-merge, no lucide |
| Build | 3 Vite entries (`index` / `mobile` / `admin`) + Capacitor; `admin` build is gated (`__ADMIN__`, zero admin traces in the standard bundle) |
| Gates | `check-tokens.mjs` (223L) pins token **names + values** and validates every `var(--x)` resolves; `check-contrast.mjs` (293L) recomputes WCAG for a pinned pair list; `bundle-report.mjs` |
| Tests | vitest 120 unit; Playwright 7 e2e (behavioural) |

---

## 3. The good news (what does *not* block)

1. **Tokens → Tailwind v4 `@theme` is a near 1:1 map.** The 98 tokens are already CSS custom properties. Tailwind v4 is CSS-first; `@theme` *generates* utilities from the same variables. `tokens.css` can stay the canonical file and Tailwind can consume it.
2. **`check-contrast.mjs` survives unchanged** if tokens stay declared in one CSS file — it reads `tokens.css` values and recomputes; Tailwind does not remove them.
3. **No light theme, no i18n, no SSR, single browser target.** shadcn does **not** require a light theme (see §4.1); this removes its theme-variant and SSR machinery from scope.
4. **The bespoke design is *already* semantic (BEM-ish) and token-disciplined.** `tokens.css`'s own comment: *"Colour is never invented at a call site."* That discipline is exactly what makes a mechanical → `@apply`/utility mapping tractable.
5. **Motion tokens already exist on both sides** (`tokens.css` `--dur-*`/`--ease-*` ↔ `motion.ts`). They are a clean bridge to Tailwind's `--default-transition-*`.
6. **The CSS is already shaped like Tailwind.** Measured: 434 rules / 1,474 declarations; only 63 rules are exact duplicates (the file is *not* bloat). **~80% of declarations are token refs or layout primitives** (`display` 122, `gap` 80, `align-items` 58, `color` 128, `background` 108…) — each is **one word** as a Tailwind utility. And **92% of the 408 selectors** are single-class (282), state-pseudo (48), `data-*`/`aria-*` (34) or pseudo-element (12) — all native Tailwind constructs, and the `data-*` variant idiom is exactly what shadcn/Radix use.

## 4. The bad news (what does block / cost)

1. **The theme must be authored, and one name collision must be handled.** shadcn's defaults are a *preset scaffold*, not a requirement — retheming is the documented extension point (`@theme inline { --color-x: var(--x) }`). The genuine trap is **same name, different meaning**: shadcn `--accent` = interactive hover wash, `--secondary` = lower-emphasis grey; mirrorr `--accent` = signal green, `--secondary` = purple. A naive `--color-accent: var(--accent)` silently repaints every shadcn hover/selected state in brand green. Map deliberately — see §4.1.
2. **Fidelity lives in the CSS, not the components.** The 267 selectors (glass elevation, hairline borders, `--r-xs..xl` varied radii, mono/tabular numerals, the segmented thumb, JSON colouring, session/entity/discovery cards) have **no shadcn equivalent** and must be reproduced as utilities or a `@layer components` port. This is the bulk of the work and the bulk of the fidelity risk.
3. **The motion system is bespoke and library-agnostic.** shadcn/Radix animate via `data-state` + CSS keyframes (`tw-animate-css`); mirrorr uses `motion/react` variants + springs, incl. a `layout`/`layoutId` thumbnail in `Segmented`. Reproducing springs and shared-layout transitions is the **hardest fidelity item** and may simply be kept as-is.
4. **The guards are CSS-source-specific.** `check-tokens.mjs`'s `DEFINED` pass scans `src/ui/styles/*.css` for `var(--x)`. Once styling moves to utilities/`@apply`, generated declarations don't live in that source, so the gate must be rewritten (scan built CSS, or gate `@theme` instead).
5. **The lighting on "battle-tested safety" is dimmer than assumed.** The hand-rolled primitives already implement the core behaviours (see §6). What libraries add is the *long tail* of edge cases, not the basics.

### 4.1 Dark-only, and the shadcn↔mirrorr token contract

**shadcn does not enforce a light mode.** Verified against `apps/v4/content/docs/(root)/theming.mdx`: *"Dark mode works by overriding the same tokens inside a `.dark` selector."* The scaffold writes a light `:root` and a dark `.dark`; the only thing that ever selects dark is **you** adding `.dark`. There is no runtime, no provider requirement (the `next-themes` `ThemeProvider` is a Next.js-only integration — irrelevant to this Vite app), and no enforcement. For a dark-only app:

- Define mirrorr's values in `:root`; **do not** add a `.dark` block or the `.dark` class.
- The `dark:` utilities present in copied component source then simply never match — **inert, not broken**. Strip them per-component only for tidiness; they cost ~nothing at runtime (Tailwind gates them behind a selector that never matches).
- So the only real decision is the **token-name contract**, not a mode switch.

| shadcn slot | shadcn meaning | maps to mirrorr |
|---|---|---|
| `--background` / `--foreground` | app canvas + default text | `--bg` / `--text` |
| `--card` / `--card-foreground` | elevated surface | `--surface-1`…`--surface-3` / `--text` |
| `--popover` / `--popover-foreground` | floating surface | `--surface-3` / `--text` |
| `--primary` / `--primary-foreground` | high-emphasis / brand | `--accent` / `--accent-ink` |
| `--secondary` / `--secondary-foreground` | low-emphasis fill | `--surface-2` / `--text` *(NOT mirrorr `--secondary`)* |
| `--muted` / `--muted-foreground` | subtle surface + subdued text | `--surface-2` / `--text-muted` |
| `--accent` / `--accent-foreground` | **hover/active wash** | a wash derived from `--accent` / `--text` *(NOT mirrorr `--accent`)* |
| `--destructive` | error/destructive | `--danger` |
| `--border`, `--input` | borders, form borders | `--border`, `--border` |
| `--ring` | focus ring | `--ring` |
| `--radius` + `sm/md/lg/xl` | radius ladder (calc-derived) | override with `--r-xs`…`--r-xl` directly |
| `--chart-1..5` | chart palette | unused — drop (no charts) |
| `--sidebar*` | Sidebar block | only if the shadcn `Sidebar` is adopted |

Exposed via the documented pattern: `@theme inline { --color-background: var(--bg); … }`.

---

## 5. Component → shadcn/Radix mapping

Legend — Risk: **L** visual near-identical after re-skin · **M** needs restyle + behaviour swap · **H** bespoke, no equivalent or a fidelity trap. Effort: S ≈ 0.5–1d · M ≈ 1–3d · L ≈ 3–6d · XL ≈ 6–15d.

| Current | Proposed | Risk | Effort | Notes |
|---|---|---|---|---|
| `Button` (variants primary/secondary/outline/ghost/danger/danger-ghost, sizes sm/md/lg, block, icon, loading) | `Button` (+ cva) | M | M | Re-skin; variant names differ; `block`/`loading`/`icon` are custom props to keep |
| `IconButton` | `Button size="icon"` | L | S | |
| `Input`, `Textarea` | `Input`, `Textarea` | L | S | |
| `Select` | `Select` (Radix) | M | M | Native vs portal popup; verify mobile behaviour |
| `Checkbox`, `Radio` | `Checkbox`, `RadioGroup` | M | M | Custom `.check` skin |
| `Switch` | `Switch` | M | S | |
| `Field` (+`field-*`) | `Label`/`Form` | M | M | shadcn `Form` is react-hook-form-bound; this is a lighter wrapper |
| `Dialog` | `Dialog` (Radix) | M | M | See §6 — behaviour parity + motion |
| `Drawer` | `Sheet` / vaul `Drawer` | M | M | Edge slide-over; `drawer-wide` variant |
| `ConfirmDialog` | `AlertDialog` | L | S | |
| `Menu`/`DropdownMenu`/`MenuItem`/`MenuPopover` | `DropdownMenu` (Radix) | M | M | Adds typeahead, collision-aware positioning, submenus — real gain |
| `Tabs`/`Segmented`/`TabPanel` | `Tabs` (Radix) | **H** | L | shadcn has **no segmented control**; the `layoutId` thumb + roving tabindex is bespoke. Keep `Segmented` as-is; adopt Radix only for the tab *role* pattern if desired |
| `Toast`/`ToastRegion`/`toast` store | `Sonner` | M | M | Store API is `useSyncExternalStore`; shim `toast.success/error/info` onto Sonner to keep 40+ call sites |
| `Table`/`Th`/`Td` | `Table` | L | S | |
| `Avatar`, `Badge`/`Tag`, `Skeleton`, `Spinner`, `Progress`/`Stat` | `Avatar`, `Badge`, `Skeleton`, `Progress` | L | M | `Stat`/`Tag` are local perms |
| `StatusChip`/`StatusDot` | `Badge` (tone) | M | M | 6 `data-*` states; semantic tone→hue binding must be preserved |
| `Banner`/`ErrorPanel`, `EmptyState`, `Panel`, `BulkBar`, `LoadMore`, `Fab`, `Hash`, `FilePicker` | **none** | **H** | L | No shadcn equivalent; keep custom, optionally express in Tailwind |
| `JsonView` (`json-*`) | **none** | **H** | M | Custom JSON tree; keep |
| `schema-form` (437L, JSON-Schema-driven) | **Form** (RHF) *not equivalent* | **H** | XL | Schema-driven engine for resolver/engine/retry configs. RHF+shadcn `Form` is field-declarative, not schema-driven. **Keep, or wrap `Field`/controls in shadcn primitives only** |
| `icons.tsx` (206L, custom SVG set) | `lucide-react` | M | M | Icon *shapes* change → visible diffs; either keep custom icons or accept the divergence |
| `ui/chrome/*` (14 files: shell, sidebar, topbar, bottom-nav, breadcrumb, notification*, connection pill, health banner) | `Sidebar`/`Breadcrumb`/`DropdownMenu` blocks + custom | M | L | shadcn `Sidebar` is desktop-oriented; the mobile bottom-nav/FAB and the responsive `table-desktop`↔`cards-mobile` swap are bespoke |
| 71 view-only composite classes (`session-card*`, `entity-card*`, `discovery-card*`, `page-head`, `toolbar`, `stat-grid`, `url-list*`…) | **none** | **H** | XL | This is the real visual surface; shadcn has no opinion here |
| `overlay-stack.ts`, focus traps, roving tabindex | Radix internals | — | S | Delete once Radix lands (keep the `busy`/top-overlay semantics) |

**Read of the table:** ~14 rows are L/M (shadcn structure survives the re-skin largely intact). **~12 rows are H** — bespoke components with no shadcn equivalent, plus the 71 view-level classes. The H rows are where fidelity is won or lost, and they are the majority of the *surface*.

> Note on the "Risk" column: it measures **our re-skin difficulty**, not a defect in shadcn. Replacing the styling layer is what shadcn is *for*; an L/M row means we keep shadcn's structure and restyle it, an H row means we keep our own component entirely.

---

## 6. Interaction-register fidelity (the "battle-tested safety" question)

The hand-rolled primitives already cover the *basic* contract. Parity audit, current vs library:

| Behaviour | Current (`Dialog`/`Menu`/`Tabs`/`Toast`) | Radix/shadcn adds |
|---|---|---|
| Focus trap on Tab | ✅ custom `FOCUSABLE` cycle | sentinels, `disabled`/`inert` handling |
| Escape to close | ✅ with top-overlay guard | same |
| Restore focus on unmount | ✅ `restoreRef` | same + edge cases |
| Outside-click dismiss (Menu) | ✅ `mousedown` | ✅ + pointer/portal correctness |
| Arrow/Home/End nav | ✅ Menu + Tabs | ✅ + typeahead (menus) |
| Roving tabindex | ✅ Tabs | ✅ |
| Overlay stacking (nested) | ✅ 14-line `overlay-stack` | ✅ built-in |
| **Scroll lock** of background | ❌ | ✅ |
| **`aria-hidden`/`inert` of background** | ❌ | ✅ |
| **Collision-aware positioning** | ❌ (static placement/align) | ✅ floating-ui |
| `aria-modal` + SR background isolation | partial | ✅ |
| Reduced-motion | ✅ global CSS rule | ✅ |

**Conclusion:** the safety delta is real but **concentrated in ~4 items** (scroll lock, background inertness, collision positioning, nested-overlay SR correctness). Those are obtainable with **Radix primitives alone** — but shadcn is how you get them *while also* delivering the Tailwind/maintainability goal. The user's premise ("hand-writing everything lacks battle-tested safety") is **half true**: the basics are already hand-built and tested (120 unit + e2e); the gap is the edge-case long tail.

Severity for the migration register: scroll-lock / background-inert regressions and motion-timing changes are **HIGH** (perceivable); placement differences are **MEDIUM**; icon-shape and DOM-structure diffs are **LOW** if styled identically.

---

## 7. Three migration shapes

### Shape A — Full utility rewrite ("shadcn-native")
Delete the class system; port all 267 selectors + 510 `className` sites to Tailwind utilities; adopt shadcn components re-skinned to tokens.
- ✅ Maximum maintainability gain, single styling idiom, shrinks bespoke CSS to ~tokens only.
- ❌ Largest churn (re-touches every view), highest regression surface, longest time to green.
- Fidelity: **reachable at 98% only with the pixel gate**; the long tail is 24 components × pixel deltas.

### Shape B — Hybrid, incremental (**recommended; shadcn is its vehicle**)
1. Add Tailwind v4 + `@theme inline` **consuming `tokens.css`** verbatim (no visual change; CSS still loaded). **Omit Tailwind's preflight** — `base.css` already owns the reset.
2. **Theme the shadcn slots to mirrorr tokens first** (§4.1), *then* `shadcn add` components — otherwise you inherit "Beautiful Defaults" you must then strip.
3. Each added component is **re-skinned to mirrorr tokens** and replaces its hand-rolled twin (behaviour comes from Radix).
4. Keep the semantic CSS as Tailwind `@layer components` during transition; retire selectors file-by-file as each component/view converts.
- ✅ Delivers Radix behaviour + Tailwind ergonomics immediately, on a *monotonic*, reversible path.
- ✅ 98%+ fidelity is near-automatic at the start (classes unchanged).
- ❌ Slower to the "delete 3,302 lines" end state; two idioms coexist for a while.

> **shadcn is not a fourth shape** — it is the concrete realisation of Shape B. On its own it is "Radix + a replaceable styling layer + `cva` composition, shipped as source you own": it removes the behaviour work Shape A/B would otherwise hand-roll.

### Shape C — Radix-only (surgical)
Swap the ~7 hand-rolled primitives for Radix; keep everything else. No Tailwind, no shadcn.
- ✅ Cheapest; closes exactly the §6 safety gap; near-zero visual risk.
- ❌ Does **not** deliver the Tailwind/maintainability goal, and leaves the 3,302-line stylesheet in place — a *fallback*, not the recommendation.

---

## 8. Effort estimate (solo operator, Shape B, 98% target)

| Phase | Work | Dev-days |
|---|---|---|
| 0 | Visual-regression harness (baselines + diff + CI wiring) | 3–6 |
| 1 | Tailwind v4 scaffold + `@theme` from tokens + prove zero visual delta | 2–4 |
| 2 | Theme the shadcn slots to mirrorr tokens (§4.1) + `shadcn add` + re-skin the interaction layer (Dialog, Drawer, Menu, Toast, Select, Checkbox/Radio, Switch, AlertDialog) | 8–15 |
| 3 | Re-skin/replace mechanical components (Button, Input, Table, Badge, Avatar, Skeleton, Progress, Field…) | 6–10 |
| 4 | Chrome (shell, sidebar, topbar, bottom-nav, notification*, banner) | 8–14 |
| 5 | Views (38 files; composite classes → utilities/components) — **the bulk** | 20–40 |
| 6 | Motion rework (or explicit keep-as-is) + `Segmented` decision | 3–8 |
| 7 | Rewrite `check-tokens` `DEFINED` pass for the new styling source; keep `check-contrast` | 2–4 |
| 8 | Delete retired CSS, final pixel-gate pass, docs | 4–8 |
| | **Total** | **≈ 56–109 dev-days** |

Assumptions: 98% (not 99.5%+); motion largely preserved; `segmented`/`schema-form`/`JsonView`/icons kept bespoke. A 99.5% target roughly **doubles** phases 5–6.

---

## 9. Stop conditions / what would make this infeasible for 98%

- **No visual harness** → fidelity unprovable; do not start the rewrite.
- **`schema-form` + `JsonView` forced onto shadcn `Form`** → functional regression; keep them bespoke.
- **Motion parity demanded at 99%+** (springs, shared-layout thumb) → disproportionate cost; either accept a small HIGH-severity motion delta or keep `motion/react`.
- **Token values re-derived** instead of reused → `check-tokens`/`check-contrast` break and the palette drifts; the migration must *consume* `tokens.css`, not fork it.
- **Icon set swapped to lucide** without an explicit decision → widespread LOW diffs that still fail a strict 98% pixel budget.

---

## 10. Recommendation

1. **Adopt shadcn/ui as the vehicle for Shape B.** Since Tailwind is decided, shadcn strictly dominates plain Tailwind (no behaviour to hand-roll) and manual Radix (no styling glue to hand-roll). "Reskinning" is its intended workflow, not a cost.
2. **Sequence matters:** Phase 0 (pixel harness) → Phase 1 (Tailwind consuming `tokens.css`, **zero** visual delta, proven) → **theme the shadcn slots** (§4.1) → *then* `shadcn add` + convert, component by component.
3. Keep bespoke: `schema-form`, `JsonView`, `Segmented`, `icons`, the mobile chrome, and the 71 view-level composite classes — express them in Tailwind if convenient, but do not force a shadcn equivalent that does not exist.
4. Never let the migration fork the token layer: `tokens.css` stays canonical; `check-contrast` stays green; `check-tokens` is adapted, not relaxed.
5. **Dark-only is native** (§4.1): define mirrorr's values in `:root`; never add `.dark`; copied `dark:` utilities are inert.

**Bottom line:** feasible at 98%, and now the *right* shape is clear — shadcn is not a cost to be paid but the mechanism that removes behaviour work while leaving the design (tokens + component contracts) intact. The remaining risk is unchanged: the last 2% of fidelity (motion, the bespoke 20%) is the most expensive part of the program.

## 11. Build log

- **Phase 1 — Tailwind scaffold (done, `1c04454`).** `tailwindcss@4.3.3` + `@tailwindcss/vite`; `mirrorr-web/src/ui/styles/tailwind.css` maps the 98 tokens through `@theme inline`. Preflight is deliberately not imported and Tailwind's theme is imported into `layer(theme)`, so the unlayered `tokens.css` keeps ownership of every name it defines. `check:tokens` stays green (98 tokens intact, no dangling `var()`).
- **Phase 0 — pixel gate (done, `4c53579`).** `playwright.visual.config.ts` + `tests/visual/routes.visual.spec.ts`: 13 route states × 4 viewports (375/768/1280/1440), full-page, frozen clock (`page.clock.setFixedTime`) so relative-time text cannot tick, `reducedMotion: "reduce"`. Baselines are generated from `main` via a throwaway `git worktree` and committed under `tests/visual/__screenshots__/`.
  - **Measured delta: 0.** Branch vs `main` = **52/52 pass** at `maxDiffPixelRatio 0.001` / `threshold 0.2`.
  - **Negative control:** setting `--bg: #ff0000` fails **4/4** (the gate detects real change). A 1/255 shift does *not* fail — correct, the per-pixel threshold exists to ignore sub-perceptual noise.
  - **Stability:** two consecutive runs on one branch = 0 diffs.
- **`check:collisions` (new guard).** Reads the *built* stylesheet's `@layer utilities` (what Tailwind actually emitted) and intersects it with class names authored in `src/ui/styles/*.css`. Three overlaps found: `table` and `sr-only` allowlisted (both already defined here, unlayered so they still win); `--color-muted` → `.text-muted` resolved by deferring the speculative shadcn slot aliases.
- **Deferred to Phase 2:** the shadcn slot aliases (`--background`, `--primary`, `--muted`, …). They are added with the first shadcn component so each slot has a real consumer and the `muted` name clash (§4.1) is decided deliberately. A self-referential `--ease-spring: var(--ease-spring)` mapping was also removed.
- **Open items:** baseline regeneration across branches is a manual `git worktree` step (worth a script); the visual gate covers 13 states per route family but not hover/focus/dialog-open states — extend it as those components are converted.
- **Phase 2 — Button family + StatusChip + Spinner migrated to `cva` + utilities (done).** Added `class-variance-authority@0.7.1` and nothing else: deliberately **no** `clsx`/`tailwind-merge`, because every `cva` variant is written *complete* (each declares its own background, border colour, text colour and weight) so no two utilities ever target the same property and the result cannot depend on Tailwind's internal utility ordering. `Button`/`IconButton`/`Spinner`/`StatusChip`/`StatusDot` now emit utilities, and `buttonClass()`/`iconButtonClass()` are exported so the 11 raw `className="btn …"` call sites (`Toast` + six views) no longer depend on a deleted class. ~400 lines of `.btn*` / `.status-*` / `.spinner` CSS deleted (`components.css` 2065 → 1817).
  - **The finding that mattered — converting a component to utilities silently breaks every CSS rule that *customises* it from a lower layer.** Three symptoms, one cause:
    1. `base.css`'s `button { background: none; border: none; padding: 0 }` defeated `bg-brand` → **all 52 screenshots failed** (buttons rendered as bare text).
    2. `components.css`'s `.session-record-toggle[aria-pressed="true"] { background: var(--danger) }` defeated → the recording toggle lost its red fill (whole-button diff on `sessions-list` / `session-detail`).
    3. `layout.css`'s `.page-actions .btn-create { display: none }` (≤639px) defeated by `inline-flex` → the create button reappeared on mobile, **+34px** of page height at 375.
    All three are one cascade fact: **unlayered beats layered**, and within layers `utilities` beats `components`.
  - **Resolution — layer placement is load-bearing in both directions** (`src/app.css`, and it is commented there): `base.css` → `layer(base)`, so its element resets lose to utilities; `components.css` / `layout.css` stay **unlayered**, so the not-yet-migrated design system — including those contextual overrides — keeps winning exactly as it did before Tailwind existed. Each migrated component takes its rules with it, so the unlayered set shrinks toward nothing. A latent fourth case was caught the same way: `.fab { display: none }` on desktop would otherwise have been defeated too.
  - **Triage loop worth keeping.** The gate says only "11 failures". Reading the `IHDR` alone split them instantly into a vertical-shift cluster (+34px ⇒ something became visible) vs a same-geometry cluster, and a throwaway Playwright probe (`tests/visual/probe.spec.ts`, since deleted) dumping each button's rect and computed `background`/`border-color`/`color` against a `main` worktree named the exact property — `bg=rgb(248,81,73)` on `main` vs a defeated ghost variant on the branch.
  - **Result:** **52/52 at 0 diffs**, with `typecheck`, `check:tokens` (98 intact), `check:collisions`, 120/120 unit and `build` all green.
- **Phase 2b — dialogs + form controls on Radix (`0de08d7`).** `Dialog`, `Drawer` and `ConfirmDialog` moved onto `radix-ui@1.7.0` (one unified package) with hand-authored, project-style wrappers rather than the CLI's output: the CLI misfired here — it resolved the `@` alias literally (because `paths` lives only in `tsconfig.app.json`, not `tsconfig.json`), wrote 10 files into a bogus `@/` directory, and smuggled in the banned `cn` dependency without installing `radix-ui`. So `components.json` is unused and there is no vendored shadcn component; the primitive layer is Radix + our own `cva`-style wrappers. Public component APIs are unchanged and the manual close-focus restore keeps the trigger focused (asserted by `tests/e2e/interactions.spec.ts`). `overlay-stack.ts` + its test were deleted — Radix owns Escape ordering, scroll lock, background `aria-hidden` and the focus trap.
  - `Input`/`Textarea`/`Select`/`Checkbox`/`Radio`/`Switch`/`Field`/`Skeleton`/`Toast` emit utilities, sharing a `control.ts` shell. Affordances that cannot be expressed as utilities (native select chevron, checkbox/radio glyph, switch rail+thumb, skeleton shimmer) live verbatim in `@layer components` in `tailwind.css` — **not** as `@utility`, because `check:collisions` counts every selector authored in `src/ui/styles/*.css`.
  - Consumers retargeted: `schema-form`, `profiles-view`, `sources-panel`, plus `.toolbar-search .input` → `.toolbar-search input` (an element selector) so the five views that wrap `Input` were never touched. ~417 lines of dead component CSS deleted.
- **Phase 2c — panel / badge / tag / empty / banner / progress / stat / avatar (`cdfe43f`).** 35 component-CSS rules deleted (`components.css` 1404 → 1156); shared strings (`panelTitleClass`, `panelBodyClass`, …) exported for the six views that hand-wrote `panel-title`/`panel-body`. Two Tailwind-vs-hand-written-CSS hazards surfaced, both mandatory knowledge before continuing:
  1. **Source-order collision.** `cn("p-4", flush && "p-0")` emits *both* utilities and Tailwind writes `.p-4` last, so `flush` silently lost: every table gained 16px of padding above and below (**+29px** page height on `profiles-list`). `Avatar`/`Progress`/`Stat` are written variant-alternative for this reason. The rule is **one utility per property per render**.
  2. **`text-*` clobbers heading leading.** Every `--text-*--line-height` is `inherit` (so `text-*` is font-size-only), but `inherit` also overrides `base.css`'s `h1–h4 { line-height: var(--lh-tight) }`, so any `text-md` on a heading silently gains the parent's leading. `leading-tight` fixes it — the same mechanism `Button` already relied on. This was 5 of the 17 failing snapshots.
  - **Diagnosis method worth keeping:** the `-expected.png`/`-actual.png` pair decoded in pure Python (no Pillow/ImageMagick on this host) plus a background-colour run-length scan down one column split the diff into "an extra 16px of `--surface-1` above *and* below every table" in a single pass, which named `PanelBody` immediately.
- **Phase 2d — menu family (`2859e3b`).** `MenuItem`/`MenuSeparator`/`MenuPopover`/`DropdownMenu`, the account menu's identity block and `.menu-anchor`/`.account-btn` emit utilities; `menuAnchorClass`/`menuItemClass` are exported so `account-menu` and `bottom-nav` share them. Colour is emitted as mutually exclusive branches (`text-ink` xor `text-danger`). The popover **interaction stays hand-rolled** — it already covers the §6 register, and Radix's Menu would additionally need jsdom polyfills plus a rewritten `Menu.test.tsx` for no gate-visible gain. Revisit if clipping inside an `overflow-hidden` panel is ever observed (`.menu` is not portalled, so today it can be clipped).
- **Phase 2e — fab / bulk bar / load-more / hash (`2ce4195`).** `.fab` (and its phone-breakpoint override), `.bulk-*` + `@keyframes bulk-in`, `.load-more` and `.hash*` deleted (`layout.css` 720 → 694). `Fab` keeps "hidden by default, shown below 640px" as `hidden max-sm:inline-flex` and carries `data-slot="fab"` so its test asserts identity instead of a deleted class. `Hash`'s descendant styling moved onto the elements: the button is a `group`, the copy glyph reacts via `group-hover:`/`group-focus-visible:`, the copied state via `group-data-[copied=true]:`, and its transition property is `opacity,translate,color` because v4 animates the individual `translate` property rather than `transform`.
- **Component layer: converted vs deliberately bespoke.** Converted — Button, IconButton, Spinner, StatusChip/StatusDot, Dialog, Drawer, ConfirmDialog, Input, Textarea, Select, Checkbox/Radio, Switch, Field, Skeleton, Toast, Panel, Badge/Tag, EmptyState, Banner/ErrorPanel, Progress/Stat, Avatar, Menu, Fab, BulkBar, LoadMore, Hash. Bespoke per §10.3 — `Table` (`.table`/`.num`/`.cell-actions` are hook classes consumed by view-authored rules: `.table.table-stable`, `.plugin-table thead th`, `.capability-*`, row `[data-selected]`/`[data-highlight]`; the class cannot leave the element without breaking selectors defined outside the component), `JsonView`, `schema-form`, `Segmented`, `icons.tsx`.
- **Phase 3 — app-shell chrome (`1a48149`).** `.app` / `.topbar*` / `.sidebar*` / `.nav-*` / `.bottomnav*` / `.account-*` / `.conn-*` / `.health-*` / `.notif-*` moved onto utilities across the nine chrome components (`app-shell`, `topbar`, `sidebar`, `nav-list`, `bottom-nav`, `account-menu`, `connection-pill`, `health-banner`, `notification-bell`); `layout.css` 693 → 260. Verified independently: `typecheck`, 119/119 unit, 98 tokens, no unreviewed collisions, **52/52 at 0 diffs**.
- **Phase 4 — view-shared layout layer (`d46e305`).** The `.page-*` / `.toolbar-*` / `.grid-*` families and both `@media` blocks, across 28 files: `.page-section + .page-section` → `[&+&]:mt-8`, `.toolbar-search input` → `[&_input]:pl-8`, and `.page-actions .btn-create { display: none }` replaced by `max-sm:hidden` on the four create buttons. `layout.css` 260 → a 13-line comment anchor (still imported from `app.css`, so its ordering slot in the cascade survives). 52/52 at 0 diffs.
- **Phase 5 — the view-level composite classes (`6d98f3b`).** 17 files; `components.css` 927 → 352 (−575). Deleted: `.capability-*`, `.plugin-table*` (the `nth-child` widths + the 1180px block), `.table-desktop`/`.cards-mobile` (+ the 639px block), the `.entity-card*` family, `.session-card*`/`.session-grid*`/`.session-preview*`, `.url-list*`/`.url-copy*`, `.divider`, `.drawer-wide`, `.discovery-*`, `.file-picker*`/`.file-drop*`/`.file-input`. 52/52 at 0 diffs.
  - **One deliberate deviation from a stated-but-inert value.** `recordings-list` came out 8px taller: the baseline's `.session-card-urls { margin-top: var(--s-1) }` was already dead (a later, equal-specificity `.url-list { margin: 0 }` won, so the *effective* margin was 0), while Tailwind emits `.mt-1` **after** `.m-0` and re-activated it — 4px × 2 cards. Fixed by dropping `mt-1` at both `SessionUrls` call sites: the port keeps the *rendered* value, not the source-order accident.
  - **Entangled rules resolved, not forced.** `.table.table-stable .capability-stack { align-items: center }` was baked into its only consumer (`EntryMeta`, which renders exclusively inside `.table-stable`) and the rule deleted; the `.plugin-table-*` widths became explicit `Th` class names.
  - Surfaces the gate cannot reach were hand-verified declaration-by-declaration and then confirmed *emitted* in the built CSS: `.discovery-*`, `.file-drop*`/`.file-picker*`/`.file-input` → `sr-only`, the `[data-selected]`/`[data-active]`/`[data-live]` states, `record-toggle`'s `brightness-[1.08]`, and the `drawer-wide` collision (`.w-\[min\(1100px\,92vw\)\]` is emitted *after* Drawer's own width, so the wide variant wins deterministically).
- **Phase 6 — motion / `Segmented` decision (no code change).** `Segmented` stays bespoke per §10.3: theme-adjacent, self-contained, not a shadcn target. The motion layer needed no rework — the gate runs with `reducedMotion: "reduce"` and the global reduced-motion rule already covers it; the only motion touch in the whole program was Phase 2e moving `@keyframes bulk-in` to a Tailwind `animate-*`. §6's four safety gaps were closed in Phase 2b by Radix **except** collision-aware positioning, deliberately left hand-rolled for the Menu popover (not portalled, so it can still clip — recorded with its revisit trigger).
- **Phase 7 — the `check-tokens` `DEFINED` pass.** It previously scanned only the four authored stylesheets, so a mistyped `var(--token)` **inside a Tailwind class string** — which after this migration is where almost all styling lives — was invisible to every guard. It now scans `base`/`components`/`layout`/`fonts`/`tailwind.css` **and every `.ts`/`.tsx` under `src/`** (44 files), with a tiny documented `RUNTIME_PROPS` allowlist for the one custom property published per element rather than declared (`--chip-hue`, set by `StatusChip`/`StatusDot` tone variants). Negative control: `var(--definitely-not-a-token)` in a TSX fails 1/1; in a stylesheet, 1/1.
- **Phase 8 — final CSS, CI wiring, docs.** The last non-bespoke view hook, `.table-row-link` (+`:hover`), became `text-ink font-medium hover:text-brand` at its two call sites (`autoruns-list`, `autorun-detail`), so `components.css` now holds **only** the deliberately bespoke §10.3 set: the table core (`.table-wrap`, `.table`, `thead th`, `tbody td`/`tr`, `tr:hover`, `tr[data-selected]`, `tr[data-highlight]`, `@keyframes row-highlight`, `.num`, `.cell-actions`, `.cell-check`, `.table-stable`), `.segmented*`, the `.json-*` family, `kbd`, `.map-row*`. `layout.css` is an empty anchor. `.github/workflows/web.yml` now runs `check:tokens`, `check:contrast` and `check:collisions` after `build` (the collision guard reads the built `@layer utilities`, so it must follow the build) — the **pixel gate stays local on purpose**, because the baselines were generated on this host and a different font stack in CI would only produce false failures.
  - **Final gate:** `typecheck` clean · 119/119 unit · `build` ok (`main-*.css` 57.74 kB / 11.35 kB gzip) · 98 tokens over 5 stylesheets + 44 sources · 44 contrast pairs (41 gated, 3 info-only, 0 drift) · 43 authored classes vs 410 emitted, overlaps `sr-only`/`table` only · **52/52 at 0 diffs**.
- **Still open (deliberate, not blocked).** The shadcn slot aliases (§4.1) — still no consumer, because no shadcn component was ever vendored (Phase 2b kept Radix plus our own wrappers). The visual gate's reach — 13 route states × 4 viewports, no hover/focus/dialog-open states. Regenerating baselines across branches — still a manual `git worktree` step, documented in `playwright.visual.config.ts`; a script would first have to pin *which ref owns the harness* (the spec lives on the branch, the appearance to freeze lives on `main`), so it was left unguessed.

**Status: migration complete on `poc/tailwind-shadcn`** — Shape B landed end to end at 98% fidelity, with every commit gated by 52/52 zero-diff screenshots.

A live preview of the branch is served at `https://mirrorr.bigbro-itzamekyros.duckdns.org/dev/` — built with `base=/dev/` into `run/dev` via `bun run deploy:preview` (the live `run/web`/`run/admin` are never touched, so `/` deliberately keeps the pre-migration build). Refresh command + teardown: AGENTS.md.

**Post-completion A/B forensics (Oct 12 2026, `91753fa`).** Because both builds now coexist on one origin, a strict pixel A/B was run against the *deployed* pre-migration build (`/`) vs the preview (`/dev/`): 13 route scenarios × 4 viewports, identical fixtures (`installApi` copied from `tests/e2e/fixtures.ts`), frozen clock, in-canvas per-pixel decode (no Pillow needed). Result: **1 real deviation in 52 pairs** — `autoruns-list@375`, 964 px / 300 ≥4 / 255 ≥16. Binary-searched to two suspects by full computed-style chains: first the migration-added `truncate` on the slug `Tag` (removed — proved innocent, diff unchanged byte-for-byte), then the decisive probe: the visible tag's `display` was **`block` on old vs `inline-flex` on new**, shifting its text 1.47 px down (pixel dump confirmed `OLD(92,401) == NEW(92,402)`). Root cause: merge-base's `.entity-card-desc .tag { display: block; width: fit-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis }` was classed **dead** in Phase 5 because its named parent `.entity-card-desc` had become utilities (`text-sm text-ink-muted`) — the *child* rule's behaviour had silently moved to the wrapper and was dropped. Fixed at the call site (`[&>span]:block` on the wrapper + `w-fit max-w-full overflow-hidden text-ellipsis` on `Tag`; desktop markup untouched — its wrapper was bare in merge-base, so the rule never applied there). **After the fix: 0 px diff on that pair; all 52 pairs are 0 px ≥4** (the remaining 24-px "diffs" sit in the topbar connection pill's animated dot, vary per run, and never reach a 4/255 delta — invisible AA phase). Lesson for Phase 5-style bulk deletions: *"dead parent class"* is not proof — check whether a compound child rule's behaviour survived at the wrapper.

**Computed-style "typechecker" pass (Oct 12 2026, follows `547fbee`).** To get deterministic (non-pixel) equality evidence, a harness dumped the **full computed-style tree** of every element (plus `::before`/`::after` when painted) on both builds across the 13 scenarios × 4 viewports, with an OLD-vs-OLD determinism anchor. Results: **anchors 52/52 clean (harness is deterministic), DOM-structure diffs 0, element-rect diffs 0** — every element exists at the same path with a byte-identical bounding box. The 9,712 property-level diffs collapse to **91 signatures in 9 equivalence classes**, each verified: `rounded-full` clamp (`999px` vs `3.36e7px`, both exceed half-box), transition-list normalization (`background`↔`background-color`, `transform`↔`translate, scale` longhand — each build animates the property it actually writes), unpainted border-side colors (width 0/style none — painted sides spot-probed identical), stacking/geometry rewrites that preserve paint (`isolation:isolate` + `z-index:-10` bottom-nav pill, `position:relative`+`inset:0`→`static`, body `grid`→single-column `block`, `transform`↔`translate` centering — all with identical rects), Tailwind shadow composition (4 zero prefix layers + the **same** real layer, verified via full `box-shadow` read), and serialization synonyms (`0% 0%`≡`0px 0px`, `start`≡`flex-start`, 1px border-box padding under a pinned height, `sr-only` `clip-path`). The one scary-looking finding — input focus `outline 3px #ededf0`→`2px accent` — is inert: `outline-style: none` on both builds; the visible ring is the identical `box-shadow`, confirmed by a focused-input screenshot at **0 px diff**. **Verdict: resting-state style equality is now deterministically proven** (same geometry + all painted properties equal), not just screenshot-tested; remaining un-diffed surface is mid-flight transition timing and interactive end-states beyond the probed sidebar hover/focus (both identical).
