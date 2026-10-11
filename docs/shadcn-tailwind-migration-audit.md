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
- **Still open:** the migration has not yet touched `Dialog` / `Drawer` / `ConfirmDialog` (the interaction-parity items in §6), the shadcn slot aliases, or any view body.
