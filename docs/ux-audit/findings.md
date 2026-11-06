# Mirrorr console — UX findings (Phase 3)

Bottom-up: shared components → screens → flows. Every row names the evidence (screenshot and/or `file:line`), the heuristic from `framework.md`, a severity, and a concrete fix. **S1** = blocks or misleads a core task; **S2** = significant friction; **S3** = polish that costs comprehension/trust; **S4** = cosmetic.

Evidence paths: screenshots are in `docs/ux-audit/screens/<viewport>/` (captured from the route-mocked app; regenerate with `bun run gallery` in `mirrorr-web/`); code paths are relative to `mirrorr-web/`.

> **Intent override — 5 Nov 2026.** Card grids on **Sessions, Scheduled recordings and Recordings** are a deliberate product decision, not drift. Two findings below (`SES-01`, `AUT-06`) originally proposed replacing them with tables; they are rewritten to **keep the grid and fix the card**. The count/theme columns still reflect the original count, so the totals are comparable; the fixes are what changed. Profiles, Sources, Plugins and admin tables stay lists.

> **Status — 6 Nov 2026.** Where each row now stands (closed / half / pass, with the test or file that proves it) is in `closure.md`. This file keeps describing the *audited* build; `closure.md` describes the *rebuilt* one.

## Scoreboard

| Severity | Count | Theme |
|---|---|---|
| S1 | 13 | Contradictory run state; silent timezone/live-edit bugs; false empty states; import applies blind; mobile nav covers content; unscoped bulk delete |
| S2 | 34 | Card **anatomy** (nested boxes, half-empty cards, duplicate identity); 3 CTAs per page; vocabulary drift; icon-only destructive actions; missing state branches; sub-44px targets |
| S3 | 21 | Raw JSON, duplicated labels/counts, dead panels, density/responsive polish |
| S4 | 3 | Nit-level alignment/copy |
| **Total** | **71** | |

The three patterns behind most findings:

1. **The app shows its data model instead of the operator's job.** Cards, raw JSON, ids and statuses are rendered because they exist, not because they answer "what is running, is it healthy, what do I do next?"
2. **Every action is promoted to the surface.** Delete sits next to select; three "create" buttons compete; five actions sit on a run header. Nothing is prioritised, so the primary job is not visible.
3. **State is asserted, not derived.** A run can read "Recording" while its own panels say "no URL, no attempt"; a query failure renders as "nothing here"; a schedule edit reports success while dropping the field.

---

## A. Cross-cutting (components + shell)

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| CMP-01 | The fixed bottom nav overlays page content on every phone route: it cuts cards mid-row, hides `CONFIG` values, covers the `Paste JSON` label, and splits the Administration card. Content has no bottom clearance. | `v375/{sessions-list,session-detail,plugins,import-export,settings}.png` | 13, 12 | **S1** | Make the bottom nav a grid sibling or add `padding-bottom: calc(var(--bottomnav-h) + var(--safe-bottom) + var(--s-4))` to the scroll container; add a per-route "last element fully visible" assertion. |
| CMP-02 | At 768 (iPad) the sidebar collapses to a 48–60 px icon-only rail for 7 destinations, with ~700 px of unused width and no labels or tooltips. | `v768/*`, `A-10`, `C-11`, `D-05` | 5, 13 | **S2** | Keep the labelled 220 px sidebar to ≥1024; use a 180 px labelled rail at 768; icon-only only <520 with tooltips and `aria-label`. |
| CMP-03 | The page title renders twice (top-bar crumb + `h1`) on every route; SPA navigation neither moves focus nor announces the page; no skip link past the 7-item sidebar. | `v1440/sessions-list.png`, `topbar.tsx:22`, `page.tsx:25`, `page-transition.tsx:10` | 2, 10, 14 | **S2** | Top bar becomes breadcrumb-only (or drop the `h1`); focus `<main>` on pathname change; add a focus-visible "Skip to content". |
| CMP-04 | Vocabulary drift: nav/page "Presets" vs section "Profiles" vs dialog "New preset"; "Autoruns" vs every in-page string "scheduled recording"; "Sources" vs "Saved source" vs "Resolver + config". | `v1440/{profiles-list,autoruns-list}.png`, `profiles-view.tsx:240,370`, `nav-items.tsx:40`, `presets-dialog.tsx:438` | 8, 5 | **S2** | One noun per concept across nav, route, title, CTA, toast and docs: **Profiles** for the reusable capture config, **Sources** for saved resolver configs, **Scheduled recordings** for autoruns. |
| CMP-05 | Destructive actions are always-on bare glyphs next to the selection checkbox (trash ≈16 px in a ≈28 px box), at every width; delete shares weight and adjacency with edit/download. | `v1440/sessions-list.png`, `v1440/profiles-list.png`, `A-14`, `C-06` | 7, 12 | **S2** | Move delete into a per-row `⋯` overflow; 44×44 hit areas; danger tint only on hover/focus; bulk delete only after selection. |
| CMP-06 | Status semantics conflict and repeat: red means both healthy `Recording` and `Failed`; card `LIVE` is red while the top-bar `Live` is green; a card shows `Stopping…` + `LIVE`; status is rendered 2–3× per card; session ids render twice (`#106 #106`). | `v1440/sessions-list.png`, `status.ts:66-75`, `session-card.tsx:60,78` | 8, 10 | **S2** | One tone map (healthy=green, scheduled=blue, transitional=amber, failed=red, done=neutral), record-red reserved for the act of recording; one status per row; one id presentation. |
| CMP-07 | Targets and contrast miss WCAG 2.2 AA: 13 px checkboxes, 28 px filter chips, 36–38 px auth inputs/buttons, 27–29 px 404 CTA; secondary text ≈3.5:1; unfocused input border ≈1.3:1, focus is a 1 px line. | `v375/{login,register,not-found}.png`, `v1440/sessions-list.png`, `D-06`, `D-07`, `A-12` | 12, 14 | **S2** | 44 px min target (padding, not glyph size), 24 px min elsewhere; secondary text ≥4.5:1; input border ≥3:1; focus ring ≥2 px. |
| CMP-08 | A failed lookup renders as a legitimate empty state — the app's biggest trust bug. Preset dialog catalogs, notifications, import/export counts and the access editor never read `isError`. | `G-03`; `presets-dialog.tsx:171`, `notification-drawer.tsx:50`, `import-export-view.tsx:115`, `access-panel.tsx:63` | 6, 9 | **S1** | Every query branches `loading → skeleton`, `error → ErrorPanel + retry`, `empty → EmptyState`; never show "none" when the request failed. |
| CMP-09 | `Field` never binds validation to the control: no `aria-invalid`, no `aria-describedby`, and a `<label>` without `htmlFor` for composite children. | `Field.tsx:17-36`, `F-14` | 14 | **S1** | Inject `id`/`aria-invalid`/`aria-describedby`/`aria-required` into the child; use `aria-labelledby` for composite groups; audit every form. |
| CMP-10 | Failures are toast-only or silent. Notification `markRead`/`remove` have no `onError`; profile/source mutations toast after 8 s with no retry or inline record. | `G-05` | 6, 9 | **S2** | Inline error on the surface + retry; optimistic updates must roll back; never let a toast be the only evidence. |
| CMP-11 | Raw JSON is primary content: resolver configs appear as `{ type }` / `{}` table cells, profile configs as `{}`, plugin schemas as interactive trees. | `v1440/{profiles-list,plugins}.png`, `G-13`, `C-05` | 10, 11 | **S3** | One-line human summary + "View config" disclosure/popover with copy; JSON never in a scan column. |
| CMP-12 | Primary-action proliferation: Sessions empty has two green "New session" + a FAB; Presets has three create entries; Sources shows two "New source"; Sessions at 375 shows header CTA + FAB. | `v1440/sessions-empty.png`, `v1440/profiles-list.png`, `A-04`, `C-04`, `D-12` | 1, 10 | **S2** | One primary per breakpoint and per section; the empty state inherits the page action instead of duplicating it. |
| CMP-13 | Selection is not scoped to visible rows: hidden filtered rows stay selected and are deleted; bulk loops abort on first failure leaving deleted rows on screen. | `F-03`, `F-07`, `G-04` | 7, 9 | **S1** | Clear selection on filter/sort change (or intersect with visible rows); per-id try/catch returning `{deleted, failed}`, always invalidate, re-select failures. |
| CMP-14 | In-app 404 renders with no shell (no sidebar, top bar, wordmark, connection pill); one 27 px exit link. | `v1440/not-found.png`, `route-tree.tsx:17`, `D-01`, `G-08` | 5, 7 | **S1** | Attach `notFoundComponent` to `appLayout`; keep the shell; two exits (Sessions, Search) with 44 px targets. |
| CMP-15 | Breadcrumb shows an opaque id (`Sessions / #104`); the parent segment looks clickable but is a `<span>`. | `breadcrumb.ts:28`, `topbar.tsx:16` | 5, 8 | **S3** | Let views supply the entity name; render the parent as a real link. |
| CMP-16 | Page-level forms (login, register, settings password, import) trap Tab inside the form; the only escape is undocumented. | `login-view.tsx:83`, `register-view.tsx:75`, `settings-view.tsx:150`, `import-export-view.tsx:490` | 12, 14 | **S2** | Remove the focus scope from non-modal forms; reserve trapping for dialogs. |
| CMP-17 | Mobile "More" never shows an active state for Plugins/Import/Export/Settings, so landing there loses orientation. | `bottom-nav.tsx:54`, `G-18` | 5, 6 | **S3** | Mark the trigger active and `aria-current` when the path is in `MOBILE_OVERFLOW`. |
| CMP-18 | Notifications: raw dotted event names ("session 913: session.stopped"), toasts stack over the open drawer and duplicate its rows, "Mark all read" is enabled on an empty list, delete has no undo. | `D-03`, `D-04`, `G-16` | 8, 10, 7 | **S3** | One formatter + link to the entity; portal toasts outside the drawer; disable bulk actions when empty; undo or confirm delete. |
| CMP-19 | Per-page toolbars duplicate controls: Presets has two search boxes + two Refresh; list pages have Refresh beside a live WebSocket feed. | `v1440/profiles-list.png`, `C-04` | 10, 8 | **S3** | One toolbar per page (search + filter + one refresh); keep refresh only as a fallback affordance. |
| CMP-20 | Silent gate failures on first paint: auth status and plugin/profile catalogs have no loading/error branch, so CTAs flicker or stay disabled with no reason. | `G` state coverage, `F-09` | 6, 9 | **S2** | Explicit loading/error states for auth status and every catalog; state the reason beside a disabled primary. |

---

## B. Screens

### SCR-03 · Sessions list

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| SES-01 | The card's preview region is a blank black 16:9 box on every run without a live frame (5 of 6 in the capture), so half of each card (~377×196 px at 1440, ~660 px tall cards at 375) carries nothing. Six runs need ~2.5 screens at 1440, ~3 at 768, ~5 at 375. The grid itself is intended — **the empty region is not**. | `v1440/v768/v375/sessions-list.png`, `session-card.tsx:56` | 10, 11 | **S1** | Keep the card grid; replace the 16:9 region with an **88 px status strip** that shows the frame when one exists and a **hero fact** when it does not (elapsed, exit reason + attempts, file size, countdown). Equal card heights, no empty boxes. See `plan.md` §2.2 and `mockups/sessions-cards-1440.png`. |
| SES-02 | "Hover a card to preview its stream" is the primary instruction on touch layouts where hover does not exist; the giant preview box also swallows taps without navigating. | `v375/sessions-list.png`, `A-11` | 8, 13, 9 | **S2** | Make the whole card/row a link; preview only on pointer-capable devices; copy becomes "Open a run to watch". |
| SES-03 | Identity is inconsistent: five cards render `#106 #106` (id twice), the sixth renders `F1Weekend #101`; the profile name column is `—` while the title/source repeat. | `v1440/sessions-list.png`, `A-08` | 5, 10 | **S2** | One identity rule: `profile or autorun name` primary, `#id` muted mono secondary, source third; never title-fallback to the id. |
| SES-04 | Counts repeat: `6 sessions in account` (ops strip) and `6 sessions` (selection row). Status repeats as chip + right label + header action. | `v1440/sessions-list.png`, `A-08` | 10 | **S3** | One count in the toolbar; one status per row; remove the duplicate overlay label. |
| SES-05 | A session card claims `Scheduled` while the ops strip says `NEXT SCHEDULE none pending`; the date cell says `— · not started`. | `v1440/sessions-list.png`, `A-02` | 6 | **S2** | Derive "next schedule" from the same query; never emit `Scheduled` without a timestamp. |
| SES-06 | The same sentence "No media yet — nothing published for this run." is printed on six cards; a list-level empty/zero-media note would say it once. | `v1440/sessions-list.png`, `A-03` | 10 | **S3** | Remove per-row copy; show one toolbar note or a muted em-dash in a media column. |
| SES-07 | Filter words `Live / Spent / All` are internal jargon and are plain buttons rather than a tablist; no sort control; "Refresh" duplicates live updates. | `v1440/sessions-list.png`, `sessions-list.tsx:172` | 8, 11 | **S3** | `Live / Finished / All`; segmented control with `aria-pressed`; add sort (newest, longest, failed); drop Refresh to a menu. |

### SCR-04 · Session detail

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| SDR-01 | A completed 2:30 run still says `Waiting for the supervisor — attempt 1 not started yet` and `Live URLs not configured`; a live run shows `Recording` with no URL, no attempt and an unverifiable 579 h duration. State is asserted by different fields, not computed once. | `v1440/session-detail-completed.png`, `v1440/session-detail.png`, `A-01` | 6, 9 | **S1** | One computed state (`starting / blocked / capturing / stopping / remuxing / done / failed`) drives header, pill, panels; suppress "live" panels for terminal runs and show the reason (`no web_url`, `no attempt recorded`) with the fix. |
| SDR-02 | The header's most prominent control is a red button labelled with a **state** (`Recording`), not an action; at 375 it becomes a 50 px glyph. Delete is a bare trash beside it. No "Open recording" primary for a recorded run. | `v1440/session-detail.png`, `A-06` | 1, 8, 7 | **S2** | State pill separate; primary = the current verb (`Stop recording`, `Open recording`, `Retry`); overflow for save/delete; 44 px targets. |
| SDR-03 | Desktop is one 1,300 px-wide column: two panels hold a single grey sentence, and config values sit ~1,000 px from their labels. | `v1440/session-detail*.png`, `A-13` | 11, 3 | **S2** | Two-column ≥1024: left = player + timeline, right = status/actions/config; compact key/value grid (label above value or max 320 px). |
| SDR-04 | Header, subtitle and Config snapshot all repeat engine → resolver → profile; the subtitle adds an id already in the breadcrumb and title. | `v1440/session-detail-completed.png` | 10, 2 | **S3** | Subtitle = profile → engine only; config panel owns the full snapshot. |
| SDR-05 | `Live sources` is shown for a finished run; for a recorded run it offers no path to the file. | `v1440/session-detail-completed.png` | 6, 1 | **S2** | Rename/condition the panel by status: `Stream` while live, `Recording` when a file exists, `No source configured` only when actionable. |
| SDR-06 | No route-param validation: `/sessions/abc` fetches an invalid id and reports "Session gone", implying deletion. | `route-tree.tsx:66`, `E` | 9 | **S3** | Validate numeric ids; distinguish "invalid link" from "deleted". |

### SCR-05/06 · Autoruns (scheduled recordings)

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| AUT-01 | The card prints a **local-time** window labelled "stored UTC" (`formatWindow` has no `timeZone`), while the detail says times are stored UTC and shown local — the field users quote when a recording fires an hour early. | `v1440/autoruns-list.png`, `time.ts:99`, `F-01` | 5, 8, 6 | **S1** | One `TimeZoneNote`; render `14:30 GMT+2` or format UTC and say so. Never label a local render UTC. |
| AUT-02 | While a run is live, the Start field stays editable but the payload sends only `end_time`; the save reports success and the edit is silently dropped. | `autorun-form-dialog.tsx:269`, `F-02` | 6, 9 | **S1** | Disable Start with "can't move once running" or diff and report "start ignored". |
| AUT-03 | "Run now" creates a plain session with no `autorun_id`; the schedule still fires at its start time and the detail's "Linked run" never sees the manual run. | `autorun-actions.tsx:33`, `F-04` | 1, 6, 9 | **S1** | Send `autorun_id` and link the run, or relabel "Start a copy now — the schedule still fires" and link the toast. |
| AUT-04 | The list sorts ascending by target time, so in "All" every spent schedule sorts above the upcoming ones — the next run is at the bottom, contradicting "soonest first". | `autoruns-list.tsx:93`, `F-06` | 2, 11 | **S2** | Partition: upcoming ascending, then spent descending. |
| AUT-05 | Bulk and single delete describe different rules; bulk delete of a live row never warns that its recording is stopped and deleted. | `autoruns-list.tsx:580`, `autorun-actions.tsx:140`, `F-05` | 8, 9 | **S2** | Build confirm copy from selected statuses; one sentence for both paths. |
| AUT-06 | Two schedules render as two ~380 px cards on a 1,440 px canvas, each with a **box inside the box** (the window/countdown sub-panel), name and slug on separate rows, status repeated (chip + `starting…` + `LIVE`), a third of the card empty, and no card showing what a schedule is *for* (profile → engine is an unlabelled `—` row). Grid intended; anatomy is not. | `v1440/autoruns-list.png` | 11, 10 | **S2** | One card anatomy across all three card surfaces: **88–96 px strip** (status chip left, `⋯` right, hero metric = countdown/window), body = title + one meta line (`slug · profile → engine`). Delete the inner panel and the second status. Never fewer than 2 columns at 768. See `mockups/scheduled-cards-1440.png`. |
| AUT-07 | The create dialog's profile/engine/resolver catalogs have no loading/error branch; a failed query leaves empty selects and a disabled primary with no explanation; opening early freezes mode to "custom". | `autorun-form-dialog.tsx:344`, `F-09` | 6, 9 | **S2** | Inline loading/error + retry in the field; reason line beside the CTA; re-evaluate the default mode when catalogs land. |
| AUT-08 | The detail prints Start/End/Countdown/Profile/Recording in Status, again in Schedule, again in Config snapshot; up to three warning banners stack above them. | `v1440/autorun-detail.png`, `F-12` | 10, 2 | **S3** | One Schedule panel (countdown + window + retirement) and one Config panel. |
| AUT-09 | "Linked run" shows "No run yet" while its query is loading or failed. | `autorun-detail.tsx:289`, `F-08` | 6, 9 | **S2** | Skeleton while loading, inline retry on error, empty only when the query succeeded. |
| AUT-10 | At 375 the row actions menu opens over the warning banner and status pill. | `v375/autorun-actions-menu.png`, `B` | 3, 13 | **S3** | Anchor the menu to a scrim/portal with collision handling; keep the trigger in the row's action column. |
| AUT-11 | "Your local time — stored as UTC" is printed under both Start and End; the one-shot rule ("runs once, then retires") lives only in the intro paragraph. | `v1440/autorun-form.png` | 10, 4 | **S3** | One timezone helper for the pair; put "Runs once, then retires" beside the primary. |

### SCR-07 · Recordings

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| REC-01 | Selection is not cleared on search/sort; bulk delete uses the unscoped set, so hidden cards are deleted while the visible count under-reports. | `recordings-view.tsx:295`, `F-03` | 7, 9 | **S1** | Clear on filter/sort change or delete only visible selected rows, with "N outside this filter". |
| REC-02 | Bulk delete is a sequential loop; the first failure aborts, rows stay on screen and selected, and a toast is the only evidence. | `recordings-view.tsx:126`, `F-07` | 6, 9 | **S2** | Per-id result, always invalidate, re-select failures, inline summary. |
| REC-03 | When media is not served the card says "copy link instead" but the title anchor and external-link button still open the dead URL. | `recording-card.tsx:112`, `F-10` | 8, 9 | **S2** | When `served === false`, replace both links with the copy affordance and label "File not served". |
| REC-04 | On touch the whole card opens a new tab while an external-link button sits beside it; `minmax(300px,1fr)` overflows a 320 px viewport. | `recording-card.tsx:106`, `recordings-view.tsx:249`, `F-16` | 13, 9 | **S2** | Disable card-level new-tab on coarse pointers; `minmax(min(300px,100%),1fr)`. |
| REC-05 | A failed preview renders a silent black box with a play button; no `error` listener, no poster fallback. | `session-preview.tsx:58`, `F-11` | 6, 9 | **S3** | On HLS/video error, show poster + "Preview unavailable · open file". |

### SCR-08 · Presets (Profiles + Sources)

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| PRE-01 | One page carries three create entries (New profile, New source, FAB New preset), two search boxes, two Refresh buttons and two section subtitles. | `v1440/profiles-list.png`, `C-04` | 1, 10 | **S2** | One toolbar (search + type filter), one primary "New profile" + secondary "New source" in the same toolbar; FAB mirrors the primary only on phones. |
| PRE-02 | The editor has no dirty model: scrim, Escape or Cancel silently discards everything typed, including a mutating chain. | `presets-dialog.tsx:434`, `G-01` | 7, 9 | **S2** | Dirty flag + "Discard changes?" on every close path; `busy` keeps blocking. |
| PRE-03 | Row actions are unlabeled 16 px glyphs in ~28 px boxes, edit and delete equal weight, delete adjacent to edit. | `v1440/profiles-list.png`, `C-06` | 12, 7 | **S2** | 44 px targets, labels/tooltips, delete in overflow with name in the confirm. |
| PRE-04 | Selection exists with no visible consequence until a checkbox is hit; on mobile a second select-all appears in the card header. | `v1440/profiles-list.png`, `C-07` | 7, 10 | **S2** | Sticky bulk bar on first check; one select-all per list. |
| PRE-05 | `CONFIG` shows a raw `{}` and `RETRY` says "No retry" for every row — two columns that carry no signal. | `v1440/profiles-list.png`, `G-13` | 10, 11 | **S3** | Replace with a one-line human summary ("2 sources · retry 3×") behind a disclosure. |
| PRE-06 | The Sources empty state repeats the header CTA; the Profiles section does not visually separate from Sources at 768. | `v1440/profiles-list.png`, `C-04` | 10, 3 | **S3** | Empty state points at the header action; add a divider/section header with count. |
| PRE-07 | At 375 the 3-step dialog is a long scroll with the footer permanently over the last field ("Resolver config" clipped). | `v375/preset-dialog.png` | 13 | **S3** | Keep the 3 blocks collapsible or step-wise; ensure `scroll-padding-bottom` equals the footer height. |

### SCR-09 · Plugins

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| PLG-01 | Resolver `CONFIG` renders `{ type }` with a chevron that does nothing; `HASH` shows 8-char chips, identical across rows, never the full value. | `v1440/plugins.png`, `C-05` | 5, 10 | **S2** | Human summary + copyable config popover; hash with copy and full value; warn when hashes repeat. |
| PLG-02 | Two stacked tables (Engines, Resolvers) do not share a column grid, so scanning across both breaks. | `v768/plugins.png`, `C-12` | 11, 8 | **S3** | Shared colgroup or one table with a `Kind` column. |

### SCR-10 · Import / Export

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| IMP-01 | Export says "No profiles to export" while the Presets page shows 2 profiles, and the card contains **no export control** at any width. | `v1440/import-export.png`, `C-02` | 6, 9 | **S1** | List real exportable items with checkboxes + one "Export selected"; if none, state the rule inline. |
| IMP-02 | Import has no preview: the example JSON is a *value*, `Apply import` is enabled, and there is no count, merge policy or confirmation. | `v1440/import-export.png`, `C-03` | 9, 7 | **S1** | Three steps: source → preview (counts + collisions Replace/Skip/Keep both) → "Import N items" + undo toast; example JSON as placeholder. |
| IMP-03 | File, Paste JSON and Direct URL are three co-equal inputs, all expanded, each with its own button; hand-written JSON is a first-class path. | `v1440/import-export.png`, `C-10`, `G-07` | 4, 10 | **S2** | One "Choose a bundle" primary with `File · Paste · URL` segmented; warn before replacing a staged bundle. |
| IMP-04 | Conflicts are pre-included (`included: true` default) regardless of badge. | `import-export-view.tsx:466`, `G-06` | 9, 7 | **S2** | Default conflicting items off; confirm counts before apply. |
| IMP-05 | Two empty-state shapes inside one card (1-line note vs 200 px icon block); the Export section is ~350 px for two sentences. | `v1440/import-export.png`, `C-13` | 10, 8 | **S3** | One compact empty strip with a route to create a profile. |

### SCR-11 · Settings

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| SET-01 | "Change password" is an h3 larger than its card title "Account", then repeated as the submit label; identity, password and sign-out live in one card. | `v1440/settings.png`, `C-08` | 2, 10 | **S2** | Three sibling cards: Account, Password, Sessions; card titles outrank subsections; submit = "Update password". |
| SET-02 | Password form has no rules, reveal toggle, strength/feedback region or success state; fields and button are one visual group. | `v1440/settings.png`, `C-09` | 9, 6 | **S2** | Policy hint + blur validation + reveal + `role=status` line above the button; 24 px gap. |
| SET-03 | Administration is a bare sentence + "Open console" with no user/client counts or pending-approval badge. | `v1440/settings.png`, `C-14` | 5, 6 | **S3** | Live summary ("3 users · 1 pending · 2 clients") + nav badge. |
| SET-04 | Page description says "Manage your account" even when it is the only door to administration; the button label ignores the door title. | `settings-view.tsx:29,72`, `G-19` | 8, 2 | **S3** | Describe the page by its contents; label follows the section. |

### SCR-01/02/12 · Auth and 404

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| AUT-12 | 404 has no chrome and one 27–29 px exit; H1 is 340–450 px from the message it titles. | `v1440/not-found.png`, `D-01` | 5, 1, 3 | **S1** | Render inside AppShell; one centred column; two 44 px exits. |
| AUT-13 | Auth inputs/buttons are 36–38 px; footer links have no padding. | `v375/{login,register}.png`, `D-06` | 12 | **S2** | 44 px min height; 12 px padding on text links. |
| AUT-14 | Unfocused input border ≈1.3:1; focus is a 1 px green line; tagline reads as disabled. | `v1440/login.png`, `D-07` | 14 | **S2** | Border ≥3:1, 2 px focus ring, tagline ≥11 px / 4.5:1. |
| AUT-15 | No password reveal, caps-lock hint, "Forgot password", or reserved inline error region. | `v1440/login.png`, `D-08` | 9 | **S2** | Eye toggle, caps hint, recovery link, `role=alert` line that does not reflow. |
| AUT-16 | Register states no password rule, does not mark Display name optional, and "Request access" never says approval is required. | `v1440/register.png`, `D-09` | 9, 6 | **S2** | Checklist, "(optional)", and an explicit approval sentence + submitted state. |
| AUT-17 | Auth status has no loading branch, so the CTA flips from "Sign in" to "Request access" after paint. | `G` state coverage | 6 | **S2** | Skeleton/disabled CTA until `useAuthStatus` resolves. |

### Shell / system

| ID | Issue | Evidence | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| SHL-01 | On mobile the sheet never shows who is signed in; Users/API clients and Change password are split by an "Admin" rule that groups them wrongly. | `D-11` | 3, 5 | **S3** | "Signed in as …" header + one Admin group. |
| SHL-02 | Mobile shows both the header "New session" and the FAB; the brand and page title run together ("Mirrorr Sessions"). | `D-12` | 10, 1 | **S3** | One CTA per breakpoint; separate brand from title. |

---

## C. Flows

| ID | Flow | Issue | Heuristic | Sev | Fix |
|---|---|---|---|---|---|
| FLW-01 | Start a session | The dialog commits a profile by name only; the operator cannot see which engine/resolver/retry it will run, and the right half of the dialog is an empty fallback column. | 5, 3 | **S2** | Show a 3-line profile summary (engine → resolver, retry, recording) under the picker; make fallbacks a full-width collapsible row. |
| FLW-02 | Stop/delete a live run | The card/detail offers `Stop` and `Delete` as glyphs whose difference is not visible; deleting a live run is also stopping it, but copy does not say so. | 7, 9 | **S2** | One primary verb by state (`Stop recording`), delete in overflow with explicit "stops and deletes" copy. |
| FLW-04 | Schedule a recording | A live run accepts a Start edit and silently drops it (AUT-02); the one-shot rule is hidden in prose. | 6, 9 | **S1** | Lock Start while live; state one-shot semantics at the CTA. |
| FLW-05 | Run a schedule now | The manual run is orphaned from its schedule and the schedule still fires (AUT-03). | 6, 9 | **S1** | Link the run (`autorun_id`) or state the duplication. |
| FLW-07 | Create/edit a preset | Closing discards silently (PRE-02); a failed catalog fetch looks like "no engines" (CMP-08). | 7, 9 | **S1** | Dirty guard + catalog error states. |
| FLW-08 | Import a bundle | No preview, conflicts pre-included, blind apply (IMP-02/04). | 9, 7 | **S1** | Staged preview + explicit counts + undo. |
| FLW-09 | Find/delete a recording | Hidden selections are deleted; dead links remain when media is unserved (REC-01/03). | 7, 9 | **S1** | Scope selection; one link state. |
| FLW-11 | Search/filter/paginate | Selection survives filters on every list; “select all” silently exhausts pages; no sort on sessions/recordings until recently. | 7, 6 | **S2** | Clear selection on scope change; show "selecting all…" while loading pages; add sort. |
| FLW-12 | First-run auth | Register → approve → sign-in is not described; the CTA does not say an admin must approve. | 6, 9 | **S2** | Explicit approval state and next step. |
| FLW-13 | Offline/unreachable | Health banner and connection pill are persistent and honest — **PASS**. | 6 | — | Keep. |

---

## D. Coverage ledger (audited)

| Inventory row | Audited | Where |
|---|---|---|
| SCR-01 Login | ✅ | AUT-13…17, CMP-07/16/20 |
| SCR-02 Register | ✅ | AUT-13/16, CMP-07/16 |
| SCR-03 Sessions | ✅ | SES-01…07, A-01…14, CMP-03/05/06/12 |
| SCR-04 Session detail | ✅ | SDR-01…06 |
| SCR-05 Autoruns list | ✅ | AUT-01/04/05/06, CMP-04 |
| SCR-06 Autorun detail | ✅ | AUT-02/03/08/09 |
| SCR-07 Recordings | ✅ | REC-01…05 |
| SCR-08 Presets | ✅ | PRE-01…07 |
| SCR-09 Plugins | ✅ | PLG-01/02 |
| SCR-10 Import/Export | ✅ | IMP-01…05 |
| SCR-11 Settings | ✅ | SET-01…04 |
| SCR-12 404 | ✅ | AUT-12 |
| SCR-13 Admin | ✅ (code) | ADM-01… (below) |
| OVL-01 New session | ✅ | FLW-01 |
| OVL-02 Preset editor | ✅ | PRE-02/07 |
| OVL-03 Discovery drawer | ✅ | CMP-11, G-10 |
| OVL-04 Autorun form | ✅ | AUT-02/07/11 |
| OVL-05 Bulk profile | ✅ | code pass |
| OVL-06 Access editor | ✅ | CMP-08, ADM |
| OVL-07 Save as profile | ✅ | code pass |
| OVL-08 Stop/delete menu | ✅ | CMP-05, FLW-02 |
| OVL-09 Autorun menu | ✅ | AUT-03/05/10 |
| OVL-10 Delete recording | ✅ | REC-01/02 |
| OVL-11 ConfirmDialog | ✅ | PASS (busy + danger + focus restore) |
| OVL-12 Notification drawer | ✅ | CMP-18 |
| OVL-13 Account menu | ✅ | PASS (clear, minimal) |
| OVL-14 Mobile overflow | ✅ | CMP-17, SHL-01 |
| OVL-15 File picker | ✅ | IMP-03, CMP-09 |
| OVL-16 Player error | ✅ | REC-05 |
| OVL-17 Admin dialogs | ✅ | ADM |
| FLW-01…14 | ✅ | section C |

**Admin is captured now:** SCR-13 has two gallery scenarios (`admin-users`, `admin-resources`) plus
`admin.spec.ts` (access overrides, principal search, per-row access, self/last-admin guards), so the
"audited from code only" caveat above no longer applies.

### D1. Deferred, with the reason

Four rows are fixed on one side and deliberately not on the other. Per `plan.md` §P7 that is allowed
only when the reason is written down here; the state of every other row is in `closure.md`.

| ID | What was deferred | Why |
|---|---|---|
| CMP-02 | A labelled 180 px rail at 768 px | The card grids need the width at that breakpoint. The rail stays icon-only below 1024 px with a `sr-only` label plus a native `title`, and the labelled 220 px rail returns at ≥1024. |
| CMP-15 | Naming the current record in the breadcrumb's last segment | The chrome has no access to the record's name without adding a query to every detail route, and the page's own `h1` already carries it. The parent segment is a real link. |
| CMP-18 | Drawer/toast z-order (`--z-toast` 90 above `--z-drawer` 60) | The only lever is where the shell mounts its toaster, which would re-mount the toaster for every route. The drawer no longer raises toasts itself, so the duplicate-row symptom is gone; the stacking order is unchanged. |
| SHL-01 | Grouping Administration under one "Admin" heading in the account sheet | Nothing to group in this build: the sheet holds identity, host switcher, Settings and Sign out, and the Administration door lives on Settings. The sheet now opens with `Signed in as …`. |

---

## E. What is working (keep it)

- **Token system and dark "Control Room" direction** are coherent across every screen; surfaces, hairlines, type ramp and the single green accent already look like a product, not a template.
- **Overlay engineering**: Radix + Motion with focus restore, Escape ownership (`data-owns-escape`), busy blocking, and reduced-motion handling (`Dialog.tsx`, `Drawer.tsx`).
- **Honest destructive copy** where it exists: "It will also stop and delete any running recording it started", "Schedules built from it keep their settings but stop running".
- **Empty states that teach**: Sources ("A source saves a resolver and its config for reuse"), Sessions ("A session is one capture run").
- **Status is word + dot + colour**, never colour alone; the connection pill and health banner are persistent.
- **Recordings empty state routes to Sessions** instead of dead-ending on a page that cannot create anything.
- **Bulk bar** adapts to a phone pill with overflow, and the count is announced.
