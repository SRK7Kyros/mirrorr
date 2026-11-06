# Mirrorr console — closure ledger

Every finding in `findings.md`, one row each, with where it now stands and what proves it.
Written 6 Nov 2026 at the end of the redesign; the source of truth for "is phase P7 done".

Statuses:

- **closed** — the behaviour changed and something in the repo asserts it (test name, gate or file).
- **closed (no test)** — changed and visible in code, but no automated assertion (rare; named individually).
- **half** — one half of the finding is fixed, the other is not, with the reason.
- **pass** — the finding recorded something already correct; nothing to do.

The plan's rule holds throughout: a finding is only closed by behaviour, never by a screenshot.

## Gates (6 Nov 2026)

| Gate | Command | Result |
|---|---|---|
| Unit | `bun run test:unit` | 628 passed / 61 files |
| Typecheck | `bun run typecheck` | clean (app + node) |
| Behaviour e2e | `bun run test:e2e` | 135 passed / 15 specs (`playwright.config.ts` caps 2 workers off-CI) |
| Visual | `bun run test:visual` | 246 passed / 6 skipped across v375/v768/v1280/v1440, 129 baselines regenerated once at the end of the redesign |
| Accessibility | `bun run test:a11y` | 101 passed / 3 skipped at 375/768/1280/1440, axe + 24 px target sweep |
| Facts kept | `bun run test:facts` | 4 passed (the timezone case is live, not `fixme`) |
| Tokens | `bun run check:tokens` | ok, 101 pinned tokens, 0 dangling |
| Contrast | `bun run check:contrast` | ok, 45 pairs, 0 drift |
| Collisions | `bun run check:collisions` | no unreviewed collisions |

## Cross-cutting

| ID | Status | Where it stands / proof |
|---|---|---|
| CMP-01 | closed | `page.tsx` pads the page column by `--bottomnav-h + --safe-bottom`; `autoruns.spec.ts` "a phone keeps the bulk bar clear of the bottom nav" measures both boxes. |
| CMP-02 | half | The rail is icon-only below 1024 px, with the label kept as `sr-only` text plus a native `title` tooltip (`nav-list.tsx`). A labelled 180 px rail at 768 was **not** adopted: the card grids need the width, and the labelled 220 px sidebar returns at ≥1024. |
| CMP-03 | closed | Top bar is breadcrumb/wordmark only, one `h1` per page; SPA navigation focuses `#page-main` and announces the crumb; a `.tab-stop` "Skip to content" link is the first Tab stop. `tab-map.spec.ts` (4 tests) walks the real pages. |
| CMP-04 | closed | One noun per concept (plan §2.4): Profiles, Sources, Autoruns, Sessions, Recordings; `Presets` and "scheduled recording" are gone from every string; `autoruns.spec.ts` + `presets.spec.ts` assert the dialog and toast copy. |
| CMP-05 | closed | Delete lives in the per-row `⋯` (`RowActions`, danger item, separator before), 44 px targets; bulk delete only exists after `Select`. |
| CMP-06 | closed | `STATUS_MAP` is the single tone source (healthy/scheduled/transitional/failed/spent), one `StatusChip` per card, one id presentation. |
| CMP-07 | closed | `a11y.spec.ts` sweeps targets (44 px coarse / 24 px fine) and runs axe at 375/768/1280/1440; `check:contrast` gates 45 pairs. |
| CMP-08 | closed | `QueryState` (skeleton → `ErrorPanel` + Retry → empty) on every list, the new-session catalogs, the notification drawer, import/export and the access editor; the profile/source editor's three catalogs go through `CatalogGate`. A failed fetch never renders as "none" — `presets-dialog.spec.ts` "a failed engine list is an error with Retry, never an empty list". |
| CMP-09 | closed | `Field` clones the control with `id`/`required`/`aria-invalid`/`aria-describedby`; every form in the app goes through it. |
| CMP-10 | closed | Failures are inline (`Banner` with `onError`) and mutations roll back; the notification drawer, profile/source mutations and recording deletes all have an inline record. |
| CMP-11 | closed | JSON only inside `JsonView` disclosures (`ConfigRow`, plugins config); no raw `{}` in a scan column. |
| CMP-12 | closed | One primary action per page and per section; the empty state inherits the page action; the FAB mirrors it on phones only. |
| CMP-13 | closed | `useScopedSelection` on all six lists: selection is intersected with the visible rows and cleared on scope change; bulk loops collect per-id failures. |
| CMP-14 | closed | `notFoundComponent` sits on the app layout, so the 404 keeps the shell; two 44 px exits. |
| CMP-15 | half | The parent segment is a real link (`topbar.tsx`). The current segment still prints `#id` on detail routes: the chrome has no access to the record's name without adding a query, and the page's own `h1` carries it. |
| CMP-16 | closed | Page-level forms (login, register, settings password, new session) no longer trap Tab; `interactions.spec.ts` proves the order field → reveal toggle → next field → submit → out. |
| CMP-17 | closed | `More` sets `aria-current="page"` and the active tint when the current route is one of its children (`bottom-nav.tsx`). |
| CMP-18 | half | Rows are human sentences with a link to the entity, `Mark all read` is disabled empty/errored/pending, delete confirms and names the row, failures are inline. The z-order half is deferred: `--z-toast` (90) sits above `--z-drawer` (60) and the only lever is the shell's toast mount. The drawer now raises no toasts itself, so the duplicate-row problem is gone. |
| CMP-19 | closed | One `PageToolbar` per list page (search + sort/filter + one Refresh); no page has two search boxes. |
| CMP-20 | closed | Auth status and every catalog have explicit loading/error branches, and a disabled primary states its reason in a line bound by `aria-describedby`. |

## Sessions list (SCR-03)

| ID | Status | Where it stands / proof |
|---|---|---|
| SES-01 | closed | `EntityCard` `media` slot: live frame → published cover → plate with real fields; fixed height, no empty 16:9 box. `entity-card.test.tsx` + the uniform-height test. |
| SES-02 | closed | The whole card navigates; the preview is pointer-only and carries `data-card-ignore`; copy is "Open a run to watch". |
| SES-03 | closed | One identity rule: profile/autorun name, `#id` muted mono, source third. |
| SES-04 | closed | One count (toolbar) and one status per card. |
| SES-05 | closed | The ops strip and the card read the same queries; nothing prints `Scheduled` without a timestamp. |
| SES-06 | closed | The per-card "No media yet" sentence is gone; the plate carries the record's own fields. |
| SES-07 | closed | `All · Live · Finished` as a one-token segmented control with `aria-pressed`, plus a sort control (newest / oldest / name). |

## Session detail (SCR-04)

| ID | Status | Where it stands / proof |
|---|---|---|
| SDR-01 | closed | `deriveRunState()` drives header, chip, panels and banner once; a terminal run shows no live panel and never the supervisor sentence (`session-detail.test.tsx`). |
| SDR-02 | closed | Status chip separate; primary is the verb (`Stop recording` / `Open recording`); save + delete in `⋯`; 44 px measured. |
| SDR-03 | closed | Two columns at ≥1024 (measured 762 / 381 px at 1440), one column below; facts are a compact key/value grid. |
| SDR-04 | closed | Subtitle is `profile → engine`; the full chain, ids and both JSON snapshots live in the collapsed `Config`. |
| SDR-05 | closed | `Stream` while live, `Recording` when a file exists, nothing otherwise; a recorded run gets playback + `Open recording` + `All recordings`. |
| SDR-06 | closed | `parseSessionId` rejects a non-numeric id with its own page and never calls the API; a 404 keeps "Session #7 is not here". |

## Autoruns (SCR-05/06)

| ID | Status | Where it stands / proof |
|---|---|---|
| AUT-01 | closed | One timezone helper (`time.ts`); a card prints the viewer's clock and claims no zone, and the page names the zone once through `PageToolbar`'s `note={ <TimeZoneNote /> }` on Sessions, Autoruns and Recordings. `fact-inventory.spec.ts` "time is shown in the viewer's zone and named once per page" fails on a card that says UTC and on a page without the note. |
| AUT-02 | closed | Start is locked while the run is live, with the reason beside the field; the payload diff is unchanged otherwise. |
| AUT-03 | closed | `Run now` sends `autorun_id`, so the run is linked and the toast points at it. |
| AUT-04 | closed | Upcoming ascending, then spent descending; the `Soonest first` label now matches. |
| AUT-05 | closed | One confirm builder for both paths, naming which selected rows are live and that deleting them stops the recording first. |
| AUT-06 | closed | One card anatomy: hero strip (chip · countdown/window · `⋯`) + title + one meta line; no inner panel, one status, ≥2 columns at 768. |
| AUT-07 | closed | Profile/engine/resolver catalogs branch loading → error + Retry → empty, and the disabled primary names the failed list (`autorun-form-dialog.tsx`). |
| AUT-08 | closed | One `Schedule` panel and one `Config` panel; notices are a single ordered list rather than stacked banners. |
| AUT-09 | closed | `Linked run` is a skeleton while loading, `ErrorPanel` + Retry on failure, empty only on success. |
| AUT-10 | closed | The row menu renders in a portal with collision handling; the trigger stays in the row's action column. |
| AUT-11 | closed | One timezone row for the Start/End pair; "runs once at its start time, then retires" sits beside the primary. |

## Recordings (SCR-07)

| ID | Status | Where it stands / proof |
|---|---|---|
| REC-01 | closed | Selection is scoped to the cards on screen (`useScopedSelection`); a filter change clears it. |
| REC-02 | closed | Bulk delete collects per-id results, always invalidates, re-selects failures and summarises inline. |
| REC-03 | closed | When the file is not served the card renders the plate and a copy-link button, with no dead anchor or external-link control (`recording-card.test.tsx`). |
| REC-04 | closed | The card does not open a new tab on coarse pointers; the grid uses `minmax(min(300px,100%),1fr)`. |
| REC-05 | closed | The preview reports a fatal HLS error as "Preview unavailable — open it to watch" and clears it for the next playlist (`session-preview.test.tsx`); the full player swaps a media error for a panel that says so and links `Open the file` (`session-player.test.tsx`). |

## Profiles + Sources (SCR-08)

| ID | Status | Where it stands / proof |
|---|---|---|
| PRE-01 | closed | One toolbar (search + sort + `Select` + Refresh), one page primary `New profile`, `New source` on its own section head, no second search box. |
| PRE-02 | closed | Dirty model (`presets-dialog-dirty.ts`, 20 unit tests) with `Discard changes?` naming the unsaved fields on every close path — scrim, Escape, X, Cancel and the Profile↔Source tab — including a staged chain; an untouched dialog does not ask. `presets-dialog.spec.ts` drives all of it in a browser. |
| PRE-03 | closed | Row actions are labelled 44 px controls in the `⋯` overflow with the name in the confirm; edit and delete are no longer peers. |
| PRE-04 | closed | `Select` mode is an explicit step and one bulk bar; one select-all per list, with `indeterminate`. |
| PRE-05 | closed | `CONFIG`/`RETRY` columns replaced: retry renders as a `Tag` only when a policy exists, config lives in the row disclosure. |
| PRE-06 | closed | Profiles and Sources are two `Section`s with their own counts; the empty state points at the section's action. |
| PRE-07 | closed | The footer is a sibling of the scroll body with a 64 px `BodyTail` plus `scroll-mb-20` on the controls, so focusing the last field leaves it clear; `presets-dialog.spec.ts` measures the clearance at 375 (108.6 px, footer top == body bottom). |

## Plugins (SCR-09)

| ID | Status | Where it stands / proof |
|---|---|---|
| PLG-01 | closed | One table with `Name · Kind · Capabilities · Hash · Config · ⋯`; hash is copyable and full-value, duplicate hashes are flagged per row plus a page banner; config is a `JsonView` disclosure. |
| PLG-02 | closed | Engines and resolvers share one table grid through the `Kind` column. |

## Import / Export (SCR-10)

| ID | Status | Where it stands / proof |
|---|---|---|
| IMP-01 | closed | The export panel lists real exportable items with checkboxes and one `Export selected`; an empty list states the rule. |
| IMP-02 | closed | Three steps: choose a bundle → preview with counts and per-item collisions → `Import N items`, with an undo toast. |
| IMP-03 | closed | One `Choose a bundle` primary with `File · Paste · URL`; replacing a staged bundle asks first. |
| IMP-04 | closed | Conflicting items default to excluded; the apply confirms counts. |
| IMP-05 | closed | One compact empty strip per section with a route to create a profile. |

## Settings (SCR-11)

| ID | Status | Where it stands / proof |
|---|---|---|
| SET-01 | closed | Three sibling cards (Account, Password, Sessions); the submit reads `Update password`. |
| SET-02 | closed | Policy hint, reveal toggle, a reserved `aria-live` success/error line above the button, 24 px spacing. |
| SET-03 | closed | The console door carries live counts (`3 users · 1 pending · 2 API clients`) or says they are unavailable. |
| SET-04 | closed | The page describes its contents; the door button label follows the door (`Open administration` / `Open console`). |

## Auth and 404 (SCR-01/02/12)

| ID | Status | Where it stands / proof |
|---|---|---|
| AUT-12 | closed | 404 renders inside the shell, one centred column, two 44 px exits. |
| AUT-13 | closed | Auth inputs and buttons are ≥44 px; footer links carry padding. |
| AUT-14 | closed | Input border ≥3:1 (`--control-border`, gated at 4.00:1), 2 px focus ring, tagline at reading contrast. |
| AUT-15 | closed | Reveal toggle, Caps Lock hint, recovery link, reserved `role=alert` error region. |
| AUT-16 | closed | Password rule, `(optional)` on the display name, explicit "an admin must approve" sentence and a submitted state. |
| AUT-17 | closed | The CTA is a skeleton/disabled until `useAuthStatus` resolves, so it never flips after paint. |

## Shell / system

| ID | Status | Where it stands / proof |
|---|---|---|
| SHL-01 | half | The account sheet now opens with `Signed in as …` / `Signed in as API client`. The "one Admin group" half has nothing to group in this build: the sheet holds identity, host switcher, Settings and Sign out, and the Administration door lives on the Settings page. |
| SHL-02 | closed | One CTA per breakpoint (header on desktop, FAB on phones), and the wordmark is separated from the page title. |

## Flows (section C)

| ID | Status | Where it stands |
|---|---|---|
| FLW-01 | closed | New session shows a three-line profile summary (source → engine, retry, recording) and the chain as a full-width row; each catalog has loading/error/empty, and the disabled Start names the exact reason. |
| FLW-02 | closed | One primary verb per state (`Stop recording`), confirmed and named; delete lives in `⋯` and says it stops the recording first. |
| FLW-04 | closed | Start is locked while live and the one-shot rule sits beside the primary (AUT-02, AUT-11). |
| FLW-05 | closed | The manual run is linked through `autorun_id` (AUT-03). |
| FLW-07 | closed | Dirty guard + catalog error states in the editor (PRE-02, AUT-07). |
| FLW-08 | closed | Staged preview, explicit counts, default-excluded conflicts, undo (IMP-02, IMP-04). |
| FLW-09 | closed | Scoped selection and one link state (REC-01, REC-03). |
| FLW-11 | closed | Selection is cleared on scope change; the "select all" path reports while it loads pages; sessions and recordings both sort. |
| FLW-12 | closed | Register states the approval step before submitting and after (the 202 pending banner names the account); `register-view.tsx`. |
| FLW-13 | pass | Health banner and connection pill were already honest; unchanged. |

## Admin (SCR-13)

The admin build was audited from code in `findings.md` §D (it had no gallery captures then). It now has two gallery scenarios — `admin-users` and `admin-resources` — plus `admin.spec.ts` (access overrides, principal search, per-row access on every owner-bearing list, self/last-admin guards). Its rows were never numbered in `findings.md`; the surviving statement "ADM-01… (below)" had no table below it, so there is nothing to close row by row.
