# Mirrorr Web Operator UI — Design & Behavior Specification

Greenfield, decision-complete specification for the Mirrorr web client. Normative behavior comes from `docs/general-client-specification.md` (the client contract); this document resolves every UI/UX decision the client contract deliberately leaves open. Stack is pinned: React 19 + Vite + TanStack Router + TanStack Query + Tailwind CSS + Zod. Visual direction is pinned: dark-mode-first, dense, utilitarian operator console. An implementer should be able to build the entire UI from this document with zero judgment calls.

## Product Overview & Information Architecture

Mirrorr is a self-hosted live-stream recorder and scheduler. The web UI is a single-operator console: its job is to let the operator start/monitor/stop recording sessions, schedule one-shot recordings (autoruns), browse finished recordings, manage reusable profiles, inspect installed plugins, move config between installs (import/export), and administer users and API keys. It is a tool, not a product site — no marketing chrome, no onboarding tour, no empty decorative space.

**Product truths the IA must encode (from the client contract):**
- Sessions start **immediately** on create — "New session" is a commit, not a draft.
- Autoruns are **one-shot timers**, never recurring — no cron/weekday UI anywhere.
- A session in `remuxing`/`finalizing` must never show a delete control.
- `session_urls` is legitimately empty on most installs — "live URLs unavailable" is a normal state, not an error.
- Resources created via an API key belong to nobody — the UI must say so when the current principal is an API client.
- Notifications require a user session; API-key principals get no bell.

**Shell layout (all authenticated routes):**
- Left sidebar, fixed 224px, full height: nav items in this exact order — Sessions, Autoruns, Recordings, Profiles, Plugins, Import/Export, Settings. Active item: `bg/overlay` background + 2px left accent bar. Collapses to 56px icon-only below 900px viewport.
- Top bar, 48px: view title (left); right cluster = connection dot (WS state), notification bell with unread badge, user menu (display name, Change password, Log out). Admin users additionally see an "Admin" section inside Settings.
- Main region: 24px padding, no max-width (dense tables use full width); lists default to table layout ≥900px, card list below.
- Primary action per view sits top-right of the main region as a filled accent button (e.g. "New session").

**Design principles:** status-first scanning (status chip is the leftmost meaningful column); one primary action per row, the rest in an overflow menu; every destructive action confirmed; every async control action shows pending state until the authoritative WS event arrives; dense but never ambiguous — labels, not icon-only, wherever space allows.

## Routes

TanStack Router, code-based route tree. Guard: a root `beforeLoad` calls `GET /auth/me` (cached 60s); 401 → attempt `POST /auth/refresh` once → retry once → else redirect `/login` with `?redirect=<original path>`. Admin gating reads `user.role === "admin"` from the auth store; non-admin navigation to admin tabs redirects to `/settings`.

**Guard structure (exact, not to be invented):** the route tree has two branches. (1) **Public branch** — `/login` and `/register` sit under a public root with **no** auth `beforeLoad`; their only guard is a soft check against the cached `["auth","me"]`: an already-authenticated user hitting `/login` is redirected to `/sessions`, and `/register` additionally applies its `has_users` rule (redirect `/login` when users exist). (2) **Authenticated layout** — every other route (including the `/` index redirect) nests under an auth layout route whose `beforeLoad` runs the guard: `GET /auth/me` → on 401, `POST /auth/refresh` once → retry `GET /auth/me` once → on second 401 `redirect({ to: "/login", search: { redirect: <original full path> } })`. After a successful login, navigate to `search.redirect` when present and safe (same-origin path beginning with `/`, not `//`), else `/sessions`.

| Path | Access | View | Notes |
|---|---|---|---|
| `/login` | public | Login | If already authed → redirect `/`. Reads `?redirect`. |
| `/register` | public | Register (bootstrap) | Only reachable when `GET /auth/status` = `has_users:false`; otherwise redirect `/login`. |
| `/` | auth | — | Redirect to `/sessions`. |
| `/sessions` | auth | Sessions list (home) | Default landing after login. |
| `/sessions/$sessionId` | auth | Session detail / live monitor | Deep-linkable; invalid id → 404 view. |
| `/autoruns` | auth | Autoruns list | `?filter=scheduled|live|spent|all` (default `scheduled+live`). |
| `/autoruns/$autorunId` | auth | Autorun detail | Shows linked live session when active. |
| `/recordings` | auth | Recordings grid | |
| `/profiles` | auth | Profiles list | Create/edit are dialogs on this view. |
| `/plugins` | auth | Plugins (engines + resolvers) | Read-only introspection. |
| `/import-export` | auth | Import wizard | Export lives as row actions on Profiles/Autoruns; this route is the import wizard + export explainer. |
| `/settings` | auth | Settings — Account tab | Change password. |
| `/settings/users` | admin | Settings — Users tab | List/delete users; register-new-user form (admin-gated `POST /auth/register`). |
| `/settings/clients` | admin | Settings — API clients tab | Create/list/revoke API keys. |
| `*` | — | Not found | 404 view with link home. |

Rules: no modal-only routes (dialogs are local state, deep links always land on full views); after login, navigate to `?redirect` or `/sessions`; after logout, full client cache wipe then `/login`; after change-password success, force logout flow to `/login` with toast "Password changed — sign in again".

## Design Tokens & Visual System

Dark-mode-first, dense, utilitarian operator console. No light theme in v1 (theme switcher is out of scope). All values are CSS custom properties consumed by Tailwind via `theme.extend.colors` referencing the vars; the vars below are the single source of truth.

**Color — surfaces & text**

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0B0D11` | App background |
| `--bg-raised` | `#11141B` | Sidebar, tables, cards |
| `--bg-overlay` | `#171B24` | Dialogs, popovers, hover rows, active nav |
| `--bg-inset` | `#080A0D` | Code/mono wells, log panes |
| `--border` | `#232936` | Default 1px borders |
| `--border-strong` | `#2E3547` | Focused inputs, emphasized separators |
| `--text-primary` | `#E6E9F0` | Body, headings |
| `--text-secondary` | `#9AA3B2` | Labels, meta |
| `--text-muted` | `#7E8798` | Placeholders, disabled, timestamps (lifted from #6B7484 — 3.91:1 failed AA on `--bg-raised`) |
| `--accent` | `#4F8CFF` | Primary buttons, links, focus ring |
| `--accent-hover` | `#6B9FFF` | Hover state |
| pressed state | `brightness(0.92)` filter on `--accent` | Active state (no darker token — a darker fill drops dark text below AA) |

**Color — semantic & status** (status chips use a 12%-alpha background of the status color + 1px 30%-alpha border; chip text = the full-strength status color, with two AA exceptions: danger chip text `#FF6B77`, neutral chip text `#9AA3B2`)

| Token | Value | Meaning |
|---|---|---|
| `--ok` | `#34C77B` | active/running, completed, success toasts |
| `--danger` | `#F04452` | recording, failed, destructive actions, error toasts |
| `--warn` | `#F5A524` | terminating, warnings, 429 toasts |
| `--info` | `#5B8DEF` | scheduled, informational |
| `--purple` | `#A78BFA` | remuxing, finalizing |
| `--neutral` | `#6B7484` | unknown status, disabled |

**Typography**

| Role | Spec |
|---|---|
| UI family | `Inter, system-ui, -apple-system, "Segoe UI", sans-serif` |
| Mono family | `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace` — ids, hashes, paths, URLs, JSON, API keys |
| Base size | 13px / 1.45 line-height (dense console) |
| Scale | micro 11px/500 (badges, chips) · small 12px/400 (table meta, timestamps) · body 13px/400 · label 12px/500 uppercase +0.04em (section labels) · title 16px/600 (view titles) · heading 20px/600 (dialog titles) · display 24px/600 (empty states only) |
| Weights | 400 regular, 500 medium, 600 semibold only |

**Spacing / sizing** — 4px base unit: `4, 8, 12, 16, 24, 32, 48`. Table row height 36px; dense input height 32px; button height 32px (sm 26px); sidebar item 36px; dialog padding 24px; card padding 16px; section gaps 24px; page padding 24px.

**Radius / borders / shadows** — radius: 4px (buttons, chips, inputs), 6px (cards, dialogs, tables), 9999px (status dot, avatar). All borders 1px `var(--border)`. No shadows on flat surfaces; overlays/dialogs only: `0 8px 24px rgba(0,0,0,0.5)`; toasts: `0 4px 12px rgba(0,0,0,0.4)`.

**Motion** — hover/background transitions 120ms ease-out; dialog/popover enter 200ms ease-out (fade + 4px translate-y); toast enter 180ms; recording status pulse 1.6s ease-in-out infinite (opacity 1↔0.45 on the status dot); spinners 800ms linear. `@media (prefers-reduced-motion: reduce)`: all animation removed, pulse replaced by static dot, transitions → 0ms.

**Iconography** — lucide-react, 16px default (14px in rows, 20px empty states), stroke 2px, always paired with text label where space allows; icon-only controls require `aria-label` + tooltip.

**Recurring component styles (mandatory, build once):**
- **StatusChip**: pill, 11px/500, dot 6px + label, colors per Status & Lifecycle Map.
- **Button**: primary (accent fill, `--bg-base` text — white text fails AA at 3.2:1 on accent), secondary (bg-overlay + border, text-primary), danger (danger fill, `--bg-base` text — white fails at 3.7:1), ghost (no fill, text-secondary). Disabled: 40% opacity, no pointer.
- **Input/Select**: bg-base, border, radius 4, 32px height, 13px; focus: border-strong + 2px accent ring offset 1; error: danger border + 12px danger message below.
- **Table**: header 11px uppercase text-muted, row 36px, row hover bg-overlay, border-bottom between rows, no vertical lines.
- **Toast**: bottom-right, 320px, bg-overlay + border, 12px radius 6, icon + message + close; auto-dismiss 5s (errors sticky until dismissed).
- **Dialog**: max-width 560px (wizards 720px), bg-overlay, radius 6, header 16px/600 + border-bottom, footer right-aligned buttons.
- **ConfirmDialog**: 400px, danger primary button for destructive actions, requires typed confirmation only for delete-user and revoke-key.

## Data Layer Contract

**HTTP client.** Single `apiFetch` wrapper: base URL `import.meta.env.VITE_API_URL` (no trailing slash), `credentials: "include"`, `Content-Type: application/json` when body present, exact paths (no trailing slashes added/removed — server has `redirect_slashes=False`). Never reads `document.cookie`. Non-2xx → throws `ApiError {status, detail, fieldErrors?}` where `fieldErrors` is parsed from 422 `detail` arrays (`{loc, msg}`) and from the custom `{detail, errors}` shape; `detail` string used for toasts. 204 → returns `undefined` (never parsed).

**Zod validation.** Every response passes a Zod schema on first parse of each query/mutation. Optional-forward-compat: schemas use `.passthrough()` on objects and mark every field the client contract lists as non-guaranteed (e.g. `engine_name`, `resolver_name`, `profile_name`, `recording_progress`, `session_folder`, `next_run_at`, `last_run_at`) `.optional()`. Parse failure → `console.warn`, invalidate the affected query, refetch once; second failure → view error state ("Unexpected server response").

**Query keys & caching (TanStack Query).**

| Key | Data | staleTime | Notes |
|---|---|---|---|
| `["auth","me"]` | `AuthResponse` | 60s | Refetched on window focus; 401 triggers refresh-once flow |
| `["sessions", params]` | infinite pages | 0 (WS is delta) | `useInfiniteQuery`, cursor |
| `["session", id]` | SessionResponse | 0 | Patched by WS |
| `["autoruns", params]` | infinite pages | 0 | |
| `["autorun", id]` | AutorunResponse | 0 | Patched by WS |
| `["recordings", params]` | infinite pages | 0 | |
| `["profiles", params]` | infinite pages | 0 | |
| `["profile", id]` | ProfileResponse | 30s | |
| `["engines"]` | EngineResponse[] | 5min | All pages: `limit=200`, follow `next_cursor` while `has_more`; name-map source |
| `["resolvers"]` | ResolverResponse[] | 5min | All pages: `limit=200`, follow `next_cursor` while `has_more`; name-map source |
| `["notifications"]` | NotificationResponse[] | 30s | REST history + writes; badge follows the two-component rule (Realtime Layer) |
| `["users"]` | UserResponse[] | 30s | Admin |
| `["clients"]` | ClientResponse[] | 30s | Admin |

**Pagination.** All lists: `useInfiniteQuery` with `limit=50`, `getNextPageParam = (last) => last.has_more ? last.next_cursor : undefined`. Filter/search changes reset the query key (new cursor). "Load more" button + IntersectionObserver auto-load; footer shows "Showing N" (never a fake total — server gives none). **Ordering:** the server does not guarantee newest-first — every list is client-sorted by `id` descending after each page merge. **Search/filter scope:** name/status search inputs filter across **all loaded pages only**; while `has_more` is true and a filter is active, the list shows a "Filter applies to loaded rows" hint with a "Load all" button that exhausts pagination (repeated `next_cursor` fetches until `has_more:false`) before presenting filtered results.

**Polling backstop (all principals, independent of socket state).** Every entity list query (`["sessions"]`, `["autoruns"]`, `["recordings"]`, `["profiles"]`) additionally runs `refetchInterval: 30000` and refetches on window focus, for every authenticated principal including admins: resources created with an API key have `requester_user_token === ""` and emit no subscribed events for any user, so **a green socket does not guarantee list completeness**. Detail views refetch on window focus and after any WS event for that id; admin surfaces (Users, API clients) refetch on focus. The API-client 10-second cadence is a stricter special case of this rule.

**Name memo-map (client contract §13.13).** Build `id→name` maps from `["engines"]`, `["resolvers"]`, `["profiles"]` once; session/autorun rows render names from the map. If the (non-guaranteed) `engine_name`/`resolver_name`/`profile_name` fields are present and non-null on a payload, prefer them and skip the map lookup; otherwise map lookup; missing id → render `#<id>` muted. Maps invalidate on `profile.*` WS events and on 5min staleness.

**Mutations — optimistic policy.**

| Mutation | Optimistic? | On success | On error |
|---|---|---|---|
| Create session/autorun/profile | No (server assigns id/status) | Insert into first page cache + navigate/toast | Inline form errors (422) or toast |
| Stop session | Pending-only (button spinner, label "Stopping…") | Wait for WS `session.updated` (terminating) — no local status write | 502/504 → error banner "Control unavailable — session may be stuck" + offer delete; 400 → toast |
| Recording enable/disable | Pending-only + disabled toggle | Wait for WS status flip; 10s timeout → refetch `GET /sessions/{id}` | 400/409 → toast, revert toggle |
| Delete session/autorun/recording/profile | Remove row after confirm | Remove from cache; for session delete await `session.deleted` WS (204 ≠ gone — show "Deleting…" row state until event or 15s poll confirms) | 409 (remuxing) → toast "Cannot delete while remuxing"; 400 (profile in use) → dialog listing referencing autoruns/sessions |
| Save-as-profile | No | Toast + invalidate `["profiles"]` | 400 duplicate name → inline |
| Import apply | No | Summary toast + invalidate profiles+autoruns | 400 → wizard error panel |
| Mark notification read | Yes (badge decrement) | Patch row | Rollback + toast |

**Auth/session expiry.** 401 on any call → single `POST /auth/refresh` → retry original once → second 401 → wipe cache, redirect `/login`, toast "Session expired". Never loop refresh (server revokes all refresh tokens on reuse). Refresh is **single-flight**: a module-level shared promise — the first 401 starts `POST /auth/refresh`, all concurrent 401s from parallel TanStack queries await the same promise and retry together; only one refresh request is ever in flight, so refresh-token rotation (JTI) cannot race. A refresh 401 rejects the shared promise once → all waiters fail → one logout, never a retry storm. Proactive refresh at 23h of uptime and on `visibilitychange` → visible when last refresh >1h ago. 429 (login/register/status) → toast "Too many attempts — try again shortly", disable submit 30s. After `POST /auth/change-password` 200 → force the logout flow (server invalidated all tokens).

**Role/owner gating.** `user.role` from `["auth","me"]` hides admin surfaces. Owner-only actions (stop, recording toggle, save-as-profile, delete) are **always rendered enabled** — the API exposes no client-readable owner token (`AuthResponse.user` carries only `id`/`username`/`role`/`display_name`, and the JWT is an httpOnly cookie unreadable from JS), so no client-side ownership predicate is implementable. The server is the authority: a non-owner attempt returns 403/404 → toast the response `detail` (e.g. "Not your session"). Admins may act on all resources. When authenticated as an API client (`AuthResponse.client` set, `user` null): hide the bell entirely, show a persistent banner "Acting as API client '<name>' — created resources belong to no user and produce no notifications". **API-client mode forces polling regardless of socket state** — key-created resources never emit subscribed events, so a green WS implies nothing: while `AuthResponse.client` is set, `["sessions"]`, `["autoruns"]`, `["recordings"]`, `["profiles"]` list queries and any open detail query run with `refetchInterval: 10000`, and the top-bar connection dot is replaced by a static neutral label "API client — polling every 10s" (never the green/amber/red WS dot).

## Realtime Layer

**Connections.** One `RealtimeManager` singleton owns two WebSockets, opened after first successful `GET /auth/me` and closed on logout:
- `${VITE_API_URL(http→ws)}/ws/events` — entity stream.
- `${VITE_API_URL(http→ws)}/ws/notifications` — bell feed (skipped entirely when `AuthResponse.user` is null — API clients get 401 on this surface).
Auth rides the httpOnly cookie (same-origin / `credentials:"include"` cross-origin); non-browser builds may use `?api_key=`. Client never sends frames; heartbeat is server-driven — client only watches for silence.

**Reconnect policy.** Exponential backoff 1s→2s→4s→8s→16s→30s (cap), max 12 attempts. On close code `4001` → treat as auth failure: run the refresh-once flow, reconnect if it succeeds, else logout. On `1013` → backoff retry (server restarting). After 12 failed attempts → persistent banner "Live updates offline — polling every 15s" and start polling the visible list query + open detail query at 15s; resume WS on next successful poll or manual "Retry" in the banner. Connection dot in the top bar: green (open), amber (reconnecting), red (offline/polling).

**Frame handling — /ws/events.** Frames are Zod-parsed loosely: `{type:"event", event:<subject>, id?, ...hint fields, data?}`. `data` (full enriched entity) is authoritative when present; top-level fields are hints. `data` may be absent (deleted events always; race on updated) → for `updated/started/stopped/crashed` without `data`, refetch `GET /{resource}/{id}` instead of crashing. Events are coalesced: incoming frames buffer and flush on a 30ms microtask timer, deduped by `(event-family, id)` keeping the newest frame, then applied:

| Subject | Cache reaction | Toast |
|---|---|---|
| `session.created` | Insert into `["sessions"]` first page; if `autorun_id` set also patch that autorun row | Only when spawned from an autorun: "Autorun '<name>' started" |
| `session.updated` | Patch `["session",id]` + row in all cached session pages | Status→completed: "Session #id completed" (configurable); status→failed handled by crashed |
| `session.started` | Same as updated (refetch if no `data`) | — |
| `session.stopped` | Same | — |
| `session.crashed` | Patch + refetch detail if open | Error toast "Session #id failed" + notification |
| `session.deleted` | Remove from all session caches; if detail open → navigate to `/sessions` | — |
| `autorun.created/updated` | Upsert autorun caches | — |
| `autorun.deleted` | Remove; detail open → `/autoruns` | — |
| `recording.created` | Invalidate `["recordings"]` | "Recording saved" with "Open" action |
| `recording.updated` | Patch | — |
| `recording.deleted` | Remove | — |
| `profile.created/updated/deleted` | Invalidate `["profiles"]` + name memo-map | — |
| `session.{id}.remux.progress` | Not cached — routed to the open session detail's progress store (`{percent, eta_seconds?, speed?}`) | — |

**Entity merge rule (idempotent, arrival-order independent — no revision/timestamp field required).** All entity caches (list pages and details) are keyed by `id`; every write is an upsert by `id`. Precedence: (1) an HTTP mutation response is used **only** to insert an id that is not already cached — if the id already exists (e.g. the `*.created` WS frame arrived first), the cached entity wins and the response body is discarded; (2) thereafter every authoritative snapshot — a WS frame carrying `data`, or a query refetch response — replaces the cached entity field-by-field, and among successive authoritative snapshots the later-arriving one wins (no field-level merge, no timestamps needed); (3) a WS frame without `data` never writes fields — it only triggers the refetch rules above; (4) optimistic local state lives outside the entity cache in a per-id `pendingActions` store, cleared as soon as any authoritative snapshot for that id lands; (5) `deleted` always wins — removes the id and cancels its pending actions. Consequence: an HTTP create response and the matching `*.created` WS frame, in either arrival order, yield exactly one row; the worst case is one redundant refetch — never a duplicate, a regression, or an unresolvable "which is newer" question.

**Remux progress.** Session detail subscribes to progress frames for its id; progress bar renders `percent`. If status is `remuxing` and no progress frame arrives within 10s (late reconnect), render indeterminate bar. Progress frames arriving for a non-open session are dropped.

**Notifications feed.** On connect the server flushes all unread, then pushes new frames `{type:"notification", data:{resource_type, resource_id, event_type, title, created_at}}`. Synthetic WS frames carry exactly `{resource_type, resource_id, event_type, title, created_at}` — never `id`, `body`, or `read`; the parsing schema must not require any of those fields and badge arithmetic never reads a `read` field. Never join them to REST rows. Badge arithmetic (single coherent rule): the badge is one number with two components — (a) REST unread rows, (b) synthetic WS frames received since connect and not yet acknowledged. A synthetic frame increments (b); marking a REST row read decrements (a); `read-all` zeroes (a) AND (b); merely opening the drawer clears nothing. When a REST row appears matching a synthetic frame's `(resource_type, resource_id, event_type)` tuple, that frame stops counting (dedupe by tuple — per contract §13.10.2 synthetic frames are never assumed to carry `id`, `body`, or `read`, and are never joined on `id`). Badge arithmetic never depends on the socket being up: (a) is readable from REST at any time, (b) is in-memory only. New push → badge++, toast only for `session.crashed`, `session.stopped`, `recording.created`, `*.failed` (user-configurable in Settings). Click → navigate per resource: `session` → `/sessions/{id}`; `autorun` → `/autoruns/{id}`; `recording` → `/recordings?highlight={id}`; `profile` → `/profiles?highlight={id}` (recordings/profiles have no detail routes in v1 — the list view scrolls to and highlights the row). Mark read/read-all/delete operate on REST rows only (`POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}`) and decrement the badge accordingly.

**Cross-client coherence.** Local mutations are never treated as the only truth: every cache mutation from a local action is provisional until either the mutation response or the matching WS event lands. Another client deleting a row is handled purely by the `*.deleted` handlers above.

## Status & Lifecycle Map

Single exported `STATUS_MAP` used by every list, card, chip, and detail header. No view may invent statuses; an unrecognized status string renders as `unknown` (neutral chip, raw string in tooltip) and logs a warning. Where a per-view action list and this map disagree, **this map wins** — it is the single source of truth for status-dependent actions; per-view prose only adds view-specific extras (e.g. Export, Use, Run now).

| Status | Label | Color token | Dot | Row actions (sessions) | Row actions (autoruns) |
|---|---|---|---|---|---|
| `scheduled` | Scheduled | `--info` | static | — | Edit, Delete, Run now |
| `active` | Running | `--ok` | static | Stop, Enable recording, overflow→Delete | Edit (locked fields), Delete |
| `recording` | Recording | `--danger` | pulsing 1.6s | Stop, Disable recording, overflow→Delete | Edit (locked), Delete |
| `terminating` | Stopping… | `--warn` | static | (Stop disabled) overflow→Delete | overflow→Delete |
| `remuxing` | Remuxing | `--purple` | spinner | none — **delete hidden** | none — delete hidden |
| `finalizing` | Finalizing | `--purple` | spinner | none — delete hidden | none — delete hidden |
| `completed` | Completed | `--ok` + ✓ icon | static | Save as profile, Delete | Save as profile, Delete |
| `failed` | Failed | `--danger` + ✕ icon | static | Save as profile, Delete | Save as profile, Delete |
| `unknown` | Unknown | `--neutral` | static | Delete | Delete |

**Rules:**
- Delete is **never rendered** (not merely disabled) on `remuxing`/`finalizing` — server 409s and data loss is possible.
- Recording toggle gated by engine capability: `can_record === false` → toggle rendered **disabled but visible** with tooltip "Engine cannot record" (server enforces the gate too — never hidden).
- Autorun lifecycle framing: `scheduled` = pending single run; `active`/`recording`/`terminating`/`remuxing`/`finalizing` = its one run is live; `completed`/`failed` = **spent** (will never run again). Spent autoruns render at 60% opacity and are hidden by the default list filter (`scheduled+live`); the filter control offers `scheduled | live | spent | all`.
- Session rows with `autorun_id` show a small "autorun" tag linking to `/autoruns/{id}`.
- Control-action pending labels: after Stop → chip shows "Stopping…" locally until WS confirms `terminating`/`completed`; if neither arrives within ~10s of the 200 response → row-level "still stopping…" state with a hard-delete offer (same affordance as the 502/504 control-unavailable banner); after recording toggle → toggle shows spinner until WS confirms the flip (10s timeout → refetch).
- Engine/resolver/profile rendering on rows: `<engine_name> → <resolver_name>` plus profile link when `profile_id` set, resolved via the name memo-map (or the optional `_name` fields when present).

## Time & UTC Handling

All server datetimes are **naive UTC** (no `Z` suffix): `started_at`, `ended_at`, `start_time`, `end_time`, `created_at`, `exported_at`, `attempts[].started_at/ended_at`, `next_run_at`, `last_run_at`.

- **Parse:** `new Date(value + "Z")` — always. Never pass the raw string to `Date`.
- **Display:** `Intl.DateTimeFormat(undefined, {dateStyle:"medium", timeStyle:"short"})` (local tz) + the local tz abbreviation appended once per view header context, e.g. "Sep 7, 2026, 10:00 (CEST)". Lists use relative time ("in 3 h", "2 min ago") with the absolute local string in a `title` tooltip.
- **Inputs:** `<input type="datetime-local">` collects local wall time; on submit convert `new Date(localValue)` → UTC → serialize as `YYYY-MM-DDTHH:mm:ss` with **no** tz suffix. Helper copy under every autorun time picker: "Your local time — stored as UTC". Never send an offset/`Z` (server 422s).
- **Validation:** client-side `end_time > start_time` with inline error; past `start_time` allowed but warned ("starts immediately — server treats past times as a backfill trigger").
- **Countdown (autoruns):** text granularity only — "starts in ~3 h 12 min", recomputed on a 10s tick (scheduler ticks ~10s; never show seconds precision). After `start_time` passes with no spawn event: "starting…" for up to 30s, then the row relies on WS.
- **Durations:** recordings use `duration_seconds` → `m:ss` under 1h, else `h:mm:ss`. Sessions derive live duration from `started_at`→now (1s tick on the open detail view only) and final duration from `started_at`→`ended_at`.
- **File sizes:** `size_bytes` → binary units, 1 decimal (`842.3 MB`), via a shared `formatBytes`.

## Per-View Specifications

Every view specifies: route · data sources · states (loading/empty/error/data) · actions & confirmations · failure UX · WS reactions. Shared components are specified once at the end and referenced by name.

### V1 — Login

| Aspect | Spec |
|---|---|
| Route | `/login` (public) |
| Data sources | `POST /auth/login`; `GET /auth/status` (on mount, once) |
| States | Loading: submit button spinner + disabled. Empty: n/a. Error: inline danger text under form ("Invalid username or password") — never a toast for 401; 429 → toast + 30s submit lockout. Data: centered card (360px) on bg-base |
| Content | Mirrorr wordmark (20px/600), username + password inputs, "Sign in" primary button, footer hint linking to `/register` only when `has_users === false` |
| Actions | Submit → 200 → navigate `?redirect` or `/sessions`; 401 → inline error |
| Failure UX | 429 toast "Too many attempts — try again shortly"; network error → "API unreachable" inline |
| WS | none |

### V2 — Register (first-user bootstrap)

| Aspect | Spec |
|---|---|
| Route | `/register` (public, only when `has_users:false`; else redirect `/login`) |
| Data sources | `GET /auth/status`; `POST /auth/register` |
| States | Loading: status fetch → full-page spinner. Error: 422 field errors inline per field; 429 toast. Data: card like Login, title "Create the first admin account" |
| Content | username, display_name (optional), password + confirm, "Create admin account" button; note "This first account becomes the administrator" |
| Actions | Submit → 200 → navigate `/sessions` (cookies set) |
| Failure UX | 400 "username taken" inline; 403 (shouldn't happen in bootstrap) → redirect login |
| WS | none |

### V3 — Sessions list (home)

| Aspect | Spec |
|---|---|
| Route | `/sessions` |
| Data sources | `GET /sessions/` (infinite, limit 50); name memo-map (`engines`, `resolvers`, `profiles`) |
| States | Loading: 5 skeleton rows. Empty: "No sessions yet — start your first recording" + primary button. Error: error panel + retry. Data: table |
| Content | Columns: Status chip · ID (mono, `#5`) · Engine → Resolver · Profile (link or `—`) · Recording (dot) · Started (relative) · Duration · Owner (only for admin) · Actions. Top-right primary: "New session" (opens D1 dialog). Live rows pulse their status dot per STATUS_MAP |
| Actions | Row: Stop (active/recording, ConfirmDialog "Stop session #id? The recording will finalize."), Enable/Disable recording (no confirm, pending state), Save as profile (completed/failed, name dialog), Delete (ConfirmDialog; hidden on remuxing/finalizing). Overflow menu holds all but the primary |
| Failure UX | Control 502/504 → row-level banner "Control unavailable — session may be stuck" + "Force delete" button; 409 delete → toast; toggle 400 → toast + revert |
| WS | `session.created` → prepend row; `session.updated` → patch row (chip, duration, urls); `session.deleted` → remove row; all coalesced 30ms |

### V4 — Session detail (live monitor)

| Aspect | Spec |
|---|---|
| Route | `/sessions/$sessionId` |
| Data sources | `GET /sessions/{id}`; name memo-map; remux progress frames |
| States | Loading: skeleton header + panels. Error/404: "Session not found" + back link. Data: header + two-column body (≥1100px) / stacked below |
| Content | Header: StatusChip + `#id` + engine→resolver + owner + duration (1s live tick while running). Body left: **Live URLs** panel — if `session_urls` non-empty, labeled links (M3U8/HTML/Outplayer) with copy buttons + "Open in new tab"; if empty, muted panel "Live URLs unavailable — the operator must set `web_url` on the server" (no spinner, no player). **Attempts timeline**: one row per attempt (index, status, started→ended, exit code, error reason when failed); "retry N" counter from `retry_attempts`. **Config panel**: resolver_config + retry mode/config as read-only JSON (mono, bg-inset). Body right: **Remux progress** card visible only in `remuxing` (percent bar + eta/speed; indeterminate after 10s without frames); **Recording** card with toggle + recording state |
| Actions | Stop (ConfirmDialog), Enable/Disable recording (pending state), Save as profile (completed/failed), Delete (ConfirmDialog; hidden remuxing/finalizing; 204 → "Deleting…" overlay until `session.deleted` WS or 15s poll) |
| Failure UX | Stop 504 → banner + force-delete offer; WS gap → 15s polling fallback banner; `data`-less `updated` frame → silent refetch |
| WS | `session.updated` → patch everything; `session.crashed` → error toast + failed chip; `session.{id}.remux.progress` → progress bar; `session.deleted` → navigate `/sessions` |

### V5 — Autoruns list

| Aspect | Spec |
|---|---|
| Route | `/autoruns` (`?filter=scheduled+live` default) |
| Data sources | `GET /autoruns/` (infinite); name memo-map |
| States | Loading: skeleton rows. Empty: "No autoruns — schedule a recording" + button. Error: panel + retry. Data: table |
| Content | Filter segmented control: Scheduled · Live · Spent · All (client-side filter — no server param). Columns: Status chip · Name (`user_friendly_name`, mono `snake_case_name` below, muted) · Engine → Resolver · Start (relative + tooltip) · End · Recording · Countdown ("starts in ~3 h") · Actions. Spent rows 60% opacity. **Filter grammar (canonical):** `?filter=` takes `+`-joined tokens from `{scheduled, live, spent, all}`; `live` = active|recording|terminating|remuxing|finalizing, `spent` = completed|failed, `all` = everything (equivalent to `scheduled+live+spent`); default `scheduled+live`; unknown tokens dropped, empty result → `all`. Filtering is client-side over loaded pages; with any non-`all` filter active and `has_more` true, the list auto-exhausts pagination (loads until `has_more:false`) so the scheduled/spent sets are complete. Top-right: "New autorun" → `/autoruns` wizard dialog (D2) |
| Actions | Edit (dialog; config fields locked when live per §13.11.2), Delete (ConfirmDialog: if live, red warning "A recording is running — deleting will stop and delete it"), Run now (client-composed `POST /sessions/` with the autorun's engine/resolver/config/retry + recording flag; toast "Session started" → navigate to new session), Save as profile (spent), Export (downloads `.json` bundle via `GET /import-export/autoruns/{id}/export`) |
| Failure UX | Run-now 422 → toast with detail; delete 400 → toast |
| WS | `autorun.updated` → patch row (status flip scheduled→active clears countdown); `session.created` with `autorun_id` → info toast "Autorun '<name>' started" + row status flip; `autorun.deleted` → remove |

### V6 — Autorun detail

| Aspect | Spec |
|---|---|
| Route | `/autoruns/$autorunId` |
| Data sources | `GET /autoruns/{id}`; linked session via `GET /sessions/` scan for `autorun_id` match (no backlink endpoint — client filters its cached pages) or follow the `session.created` WS event |
| States | Loading skeleton; 404 view; data |
| Content | Header: StatusChip + names + countdown/start/end (local, tz label). Panels: config (JSON read-only), schedule, linked live session card (when active — embeds the V4 status line + link), recording flag |
| Actions | Edit (D2; locked while live), Delete (ConfirmDialog with live warning), Run now, Save as profile |
| Failure UX | Same as V5 |
| WS | `autorun.updated` → patch; `session.created`/`updated` for linked id → live session card updates; `autorun.deleted` → navigate `/autoruns` |

### V7 — Recordings grid

| Aspect | Spec |
|---|---|
| Route | `/recordings` (`?highlight=<id>` → scroll to the card + 2s accent-ring highlight; notification click target) |
| Data sources | `GET /recordings/` (infinite, limit 50) |
| States | Loading: 8 skeleton cards. Empty: "No recordings yet — enable recording on a session". Error: panel + retry. Data: card grid (`repeat(auto-fill, minmax(260px,1fr))`, 16px gap) |
| Content | Card: title (`user_friendly_name`), mono `snake_case_name` muted, engine/resolver/profile names, duration (`m:ss`), size (`formatBytes`), created (relative), footer actions. No thumbnail — `content_url` is progressive/link-only (§13.11.5): no `<video>` embed, no scrubbing promise |
| Actions | "Open" (new tab to `content_url`), "Copy link", Delete (ConfirmDialog "Permanently deletes the file"), overflow for the rest. If `content_url` empty → Open replaced by muted hint "Media not served on this install"; reachability probed once per session (one HEAD on first Open click; 403/404 → toast "Media not reachable — file may not be served") |
| Failure UX | Delete error → toast; probe failure → copy-link fallback hint |
| WS | `recording.created` → invalidate list + toast "Recording saved" (Open action); `recording.deleted` → remove card |

### V8 — Profiles list + editor

| Aspect | Spec |
|---|---|
| Route | `/profiles` (`?highlight=<id>` → scroll to the row + 2s accent-ring highlight; notification click target) |
| Data sources | `GET /profiles/` (infinite); `engines`, `resolvers` for pickers + schemas |
| States | Loading skeleton; empty "No profiles — save a reusable configuration"; error panel; data table |
| Content | Columns: Name · Engine · Resolver · Retry mode · Owner (admin only) · Actions. Top-right "New profile" → editor dialog. Row action "Use" → opens New Session dialog (D1) prefilled |
| Actions | New/Edit dialog: name input, engine select, resolver select, `DynamicSchemaForm` for `resolver_config` (from resolver `config_schema`), retry mode select + `DynamicSchemaForm` for `retry_config` (from engine `retry_modes_schema[mode]`). Delete → pre-scan cached autoruns/sessions for `profile_id` refs → ConfirmDialog "In use by N autoruns / M sessions" (blocked state listed) or plain confirm; server 400 → same dialog populated from error. Row action "Export" → downloads `.json` bundle via `GET /import-export/profiles/{id}/export` |
| Failure UX | 400 duplicate name → inline field error; 422 → `DynamicSchemaForm` field mapping |
| WS | `profile.*` → invalidate list + memo-map |

### V9 — Plugins (engines & resolvers)

| Aspect | Spec |
|---|---|
| Route | `/plugins` |
| Data sources | `GET /engines/` + `GET /resolvers/` (all pages: `limit=200`, follow `next_cursor` while `has_more`) |
| States | Loading skeleton cards; empty per section "No engines installed"; error panel; data |
| Content | Two sections ("Engines", "Resolvers") of card grids. Engine card: name, description, origin + `origin_hash` (mono, truncated 12 chars, copy button), capability badges (`can_record`, `can_playlist` — ok-color when true, neutral "no record"/"no playlist" when false), expandable "Retry modes" showing the four mode names + their JSON schema (mono, bg-inset). Resolver card: name, description, origin hash, expandable `config_schema`. All read-only — no edit affordances anywhere |
| Actions | Copy hash only |
| Failure UX | Load error → panel + retry |
| WS | none (plugins change only on server restart/plugin reinstall; note in page footer: "Plugins are discovered at server boot") |

### V10 — Import wizard (/import-export)

| Aspect | Spec |
|---|---|
| Route | `/import-export` |
| Data sources | `POST /import-export/validate`, `POST /import-export/apply`; `engines`, `resolvers` for mapping pickers |
| States | Request-count guard: >500 profiles or autoruns → hard client-side block before validate ("Bundle exceeds 500 items"). Step state machine: 1 Choose file → 2 Review report → 3 Resolve → 4 Apply summary |
| Content | Step 1: dropzone + file picker; client-side JSON parse + `version === 1` check (else blocking error "Unsupported bundle version"). Step 2: validate call → per-item table (name, content_hash truncated mono, status badge: Ready / Skip — already imported / Needs mapping / Conflict). Step 3: for each `not_installed`/`hash_mismatch` issue — select of installed engines/resolvers (default: entry whose `origin_hash` matches, else "choose manually"); `name_conflict` → read-only preview of auto-rename (`name_2`…); `profile_missing` → select existing profile or "use inline config"; per-item include toggle (feeds `removed_profiles`/`removed_autoruns` — only sent for explicitly excluded items). Step 4: apply → summary panel `profiles_created / profiles_skipped / autoruns_created` + "View profiles" link |
| Actions | Validate (spinner), Apply (spinner + disabled), Cancel back to step 1 |
| Failure UX | Apply 400 → error panel on step 3 with server detail; re-resolution is local-only (no extra validate calls) |
| WS | After apply, `profile.*`/`autorun.created` events reconcile caches normally |

**Resolution → apply-body encoding (deterministic):** the wizard builds `POST /import-export/apply` as `{bundle: <client-edited bundle>, plugin_map, removed_profiles?, removed_autoruns?}` — the bundle sent is the *edited* one, never the raw file:
- (a) `profile_missing` (autorun references a profile absent from the bundle) — user picks one: **Bind to existing profile** → the autorun's bundle entry has its embedded `profile` object rewritten to `{"name": "<chosen installed profile name>"}` (matched by name at apply; no new profile created for it); or **Use inline config** → the `profile` key is removed from the entry and the entry keeps its own `engine`/`resolver`/`resolver_config`/`retry_*` fields, so apply creates a self-contained autorun.
- (b) `engine_override` (autorun's engine differs from its profile's) — user picks one: **Keep autorun engine** → entry unchanged (apply writes the autorun's own engine as an override over its profile); or **Use profile engine** → the entry's inline engine fields are removed so it inherits the profile's engine.
- `plugin_map` (`{<origin_hash>: {type: "engine"|"resolver", id}}`) is used **exclusively** for `not_installed`/`hash_mismatch`; `removed_*` arrays contain only names of items the user explicitly excluded. If apply's server-side revalidation rejects an edited entry (400), the wizard shows the server `detail` on step 3 and stays editable.

### V11 — Settings: Account tab (`/settings`)

| Aspect | Spec |
|---|---|
| Data sources | `POST /auth/change-password` |
| States | Loading: none (local form, user card from auth store). Empty: n/a. Error: 400 old-password inline field error. Data: user card + change-password form + notification preferences |
| Content | Current user card (username, display name, role badge); change-password form (old, new, confirm); notification preferences (which WS events toast: crashes, completions, recordings — localStorage) |
| Actions | Change password → 200 → toast "Password changed — sign in again" → forced logout to `/login` |
| Failure UX | 400 old-password inline error |
| WS | none |

### V12 — Settings: Users tab (`/settings/users`, admin)

| Aspect | Spec |
|---|---|
| Data sources | `GET /auth/users`, `DELETE /auth/users/{username}`, `POST /auth/register` (admin create) |
| States | Loading: skeleton rows. Empty: "No users" (practically unreachable — at least one admin always exists). Error: error panel + retry. Data: table |
| Content | Table: username · display name · role badge · actions. "New user" button → dialog (username, display_name, password) using the admin-gated register endpoint — this is the only user-creation path, the API has no other |
| Actions | Delete user → typed-confirmation dialog (type the username); delete button disabled on the last remaining admin (client counts admins, tooltip "Cannot delete the last admin") |
| Failure UX | 400 last-admin → toast; 403 → hide tab (route guard prevents) |
| WS | none |

### V13 — Settings: API clients tab (`/settings/clients`, admin)

| Aspect | Spec |
|---|---|
| Data sources | `GET /auth/clients`, `POST /auth/clients`, `DELETE /auth/clients/{id}` |
| States | Loading: skeleton rows. Empty: "No API clients yet — create one for programmatic access". Error: error panel + retry. Data: explainer banner + table |
| Content | Explainer banner: "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications." Table: name · created · active · actions. "New key" → name dialog → **one-time key reveal modal**: mono key in bg-inset well, copy button, danger warning "Shown once — store it now", primary "I've saved it" (closes; key never retrievable again) |
| Actions | Revoke → typed-confirmation dialog |
| Failure UX | create/revoke errors → toast |
| WS | none |

### Shared components (build once, reuse everywhere)

| Component | Contract |
|---|---|
| **D1 — New Session dialog** | Source toggle: "From profile" (select → prefills all fields, still editable) or "Custom". Engine select, resolver select, `DynamicSchemaForm` (resolver_config), retry mode + `DynamicSchemaForm` (retry_config), Recording switch (rendered disabled but visible when engine `can_record:false`, tooltip "Engine cannot record"; never hidden). Submit → `POST /sessions/` → navigate to `/sessions/{id}`. 422 → inline field errors. No date/time fields — sessions start immediately. **Profile-mode submission + dirty fields:** unedited "From profile" selection submits `{profile_id, recording}` only; any single field edit switches the body to the full explicit form (`engine_id`, `resolver_id`, `resolver_config`, `retry_mode`, `retry_config`, `recording`) — dirty tracking is per-field but submission is all-or-nothing, because the server snapshots config at create |
| **D2 — Autorun wizard dialog** | Steps: 1 Identity (`user_friendly_name`; `snake_case_name` auto-slugged `[a-z0-9_-]` with manual override + live regex validation `^[a-zA-Z0-9_-]+$`) → 2 Schedule (start/end `datetime-local`, UTC hint, end>start validation, past-start warning) → 3 Config (same widgets as D1) → 4 Review. Recording switch default on. Edit existing autorun + status live → config step fields disabled with banner "This autorun is running — only name and times can change; setting an end time in the past stops the current run". **Dirty-field submission (mirrors D1's rule shape):** create mode — unedited "from profile" submits the complete body `{user_friendly_name, snake_case_name, profile_id, start_time, end_time, recording}`; any config edit switches to the full explicit body `{user_friendly_name, snake_case_name, engine_id, resolver_id, resolver_config, retry_mode, retry_config, start_time, end_time, recording}` (explicit config in place of `profile_id`; dirty tracking is per-field, submission all-or-nothing). Edit mode (`PUT`) sends only dirty fields (`exclude_unset` semantics) — locked fields are never sent |
| **DynamicSchemaForm** | Renders any JSON Schema object: `string`→text input, `number`/`integer`→number input (min/max from schema), `boolean`→switch, `enum`→select, `array` of integers→tag input, nested `object`→collapsible group (label + indent), unknown extra keys→key/value editor rows. `default`/`default_params` prefill; `required` → marker + submit validation. Emits `{...default_params, ...values}`. Receives server 422 `loc` paths and maps them to fields |
| **StatusChip** | Per Status & Lifecycle Map; `aria-live="polite"` on detail headers |
| **ConfirmDialog** | title, body, danger/primary confirm, optional typed-confirmation input; focus-trapped, Esc cancels |
| **NotificationDrawer** | Bell → right drawer fed by **REST rows only** (`GET /notifications/`); synthetic WS frames never enter the list — they only toast and increment the badge's synthetic component (rule at the end of this row). Unread-first list (icon per event_type, title, relative time); row click → navigate + mark read (`POST /notifications/{id}/read`); "Mark all read" (`POST /notifications/read-all`); per-row delete (`DELETE /notifications/{id}`); footer "Clear" loops one `DELETE /notifications/{id}` per loaded REST row behind a single confirmation. Badge = (a) REST unread rows + (b) unacknowledged synthetic frames since connect: a synthetic frame increments (b); marking a REST row read decrements (a); `read-all` zeroes both; opening the drawer alone clears nothing; a REST row matching a synthetic frame's `(resource_type, resource_id, event_type)` tuple dedupes it out of (b) — synthetic frames are never assumed to have an `id`, `body`, or `read` field and are never joined on `id`; the arithmetic never depends on the socket being up |
| **HealthBanner** | `GET /health` failure or WS polling-fallback → top banner (amber) "API unreachable — retrying"; WS offline variant per Realtime Layer |
| **EmptyState / ErrorPanel / SkeletonRows** | Single implementations, per-view copy as specified above |

## Endpoint Coverage Matrix

Every API surface mapped to its UI consumer. Every endpoint is accounted for; endpoints with no v1 consumer are explicitly marked Reserved/Unused. No UI feature calls an endpoint not listed here.

| Endpoint | Used by |
|---|---|
| `GET /health` | HealthBanner (boot + on WS failure) |
| `GET /auth/status` | Login, Register (bootstrap branch) |
| `POST /auth/register` | Register view; Users tab (admin create) |
| `POST /auth/login` | Login |
| `POST /auth/logout` | User menu |
| `POST /auth/refresh` | apiFetch 401 flow, 23h proactive, visibilitychange |
| `GET /auth/me` | Route guard, app boot, auth store |
| `POST /auth/change-password` | Settings → Account |
| `GET /auth/users` | Settings → Users |
| `DELETE /auth/users/{username}` | Settings → Users |
| `GET /auth/clients` | Settings → API clients |
| `POST /auth/clients` | Settings → API clients (one-time reveal) |
| `DELETE /auth/clients/{id}` | Settings → API clients |
| `GET /profiles/` | Profiles list, name memo-map, D1/D2 profile pickers |
| `POST /profiles/` | Profiles editor dialog |
| `GET /profiles/{id}` | Profile editor (edit mode prefill) |
| `PUT /profiles/{id}` | Profile editor |
| `DELETE /profiles/{id}` | Profiles list (in-use pre-scan) |
| `GET /sessions/` | Sessions list; autorun detail linked-session scan |
| `POST /sessions/` | D1 dialog; autorun "Run now" (client-composed) |
| `GET /sessions/{id}` | Session detail; refetch on `data`-less WS frames |
| `DELETE /sessions/{id}` | Sessions list/detail |
| `POST /sessions/{id}/stop` | Sessions list/detail |
| `POST /sessions/{id}/recording/enable` | Sessions list/detail |
| `POST /sessions/{id}/recording/disable` | Sessions list/detail |
| `POST /sessions/{id}/save-as-profile` | Sessions list/detail (completed/failed) |
| `GET /autoruns/` | Autoruns list |
| `POST /autoruns/` | D2 wizard |
| `GET /autoruns/{id}` | Autorun detail |
| `PUT /autoruns/{id}` | D2 wizard (edit) |
| `DELETE /autoruns/{id}` | Autoruns list/detail |
| `POST /autoruns/{id}/save-as-profile` | Autoruns list/detail (spent) |
| `GET /recordings/` | Recordings grid |
| `GET /recordings/{id}` | (Reserved — grid carries all fields; no detail view in v1) |
| `DELETE /recordings/{id}` | Recordings grid |
| `GET /engines/` | Plugins page, D1/D2 engine picker + retry schemas, memo-map |
| `GET /engines/{id}` | (Reserved — list payload carries all fields incl. `retry_modes_schema`) |
| `GET /resolvers/` | Plugins page, D1/D2 resolver picker + config schema, memo-map |
| `GET /resolvers/{id}` | (Reserved — list payload carries all fields incl. `config_schema`) |
| `GET /import-export/profiles/{id}/export` | Profiles row "Export" (downloads `.json`) |
| `GET /import-export/autoruns/{id}/export` | Autoruns row "Export" |
| `POST /import-export/validate` | Import wizard step 2 |
| `POST /import-export/apply` | Import wizard step 4 |
| `GET /notifications/` | NotificationDrawer (history + badge reconcile) |
| `GET /notifications/{id}` | (Unused — list rows carry all fields) |
| `POST /notifications/{id}/read` | Drawer row click |
| `POST /notifications/read-all` | Drawer "Mark all read" |
| `DELETE /notifications/{id}` | Drawer row delete |
| `WS /ws/events` | RealtimeManager |
| `WS /ws/notifications` | RealtimeManager (user sessions only) |
| `GET /favicon.ico` | — (ignored) |

## Accessibility Floor

WCAG 2.2 AA, applied concretely to the token system:

- **Contrast (recomputed, WCAG 2.x relative luminance):** `--text-primary` on `--bg-base` = 16.0:1; `--text-secondary` on `--bg-base` = 7.6:1; `--text-muted` `#7E8798` on `--bg-raised` = 5.1:1 (meta text only, never body copy); accent `#4F8CFF` on `--bg-base` = 6.0:1 (links); button text `--bg-base` on `--accent` = 6.0:1, on `--danger` = 5.2:1. Status chip text on its 12%-alpha composite over `--bg-raised`: ok 7.0:1 · warn 7.4:1 · info 4.9:1 · purple 5.7:1 · danger (text `#FF6B77`) 6.0:1 · neutral (text `#9AA3B2`) 6.4:1 — all ≥ 4.5:1.
- **Focus:** visible 2px `--accent` ring, offset 1px, on every interactive element; never `outline:none` without the ring replacement. Focus order = DOM order; dialogs trap focus and return focus to the opener on close; Esc closes dialogs/drawers/menus.
- **Keyboard:** all actions reachable by Tab; table row actions via a focusable overflow menu button; form submit on Enter; no drag-only interactions (dropzone has a file-picker button).
- **Live regions:** toasts `role="status"` (errors `role="alert"`); StatusChip on detail headers `aria-live="polite"`; unread badge `aria-label="N unread notifications"`; WS connection dot has `role="status"` + text label in the top bar tooltip, not color-alone.
- **Status never color-only:** every StatusChip pairs a colored dot with a text label; recording pulse supplements, never replaces, the label.
- **Forms:** every input has a paired `<label>`; `DynamicSchemaForm` generates `id`/`htmlFor` pairs from the schema path; inline errors use `aria-describedby`; required fields marked visually + `aria-required`.
- **Motion:** `prefers-reduced-motion` disables the recording pulse, spinners become static hourglass icons, all transitions 0ms.
- **Hit areas:** primary pointer targets ≥ 32×32px (documented dense exception: table overflow buttons 24px minimum); icon-only buttons always have `aria-label` + tooltip.
- **Names/roles:** nav = `<nav aria-label="Primary">`; tables use real `<table>` with `<th scope="col">`; the bell is `<button aria-haspopup="dialog">`.

## Assumptions & Open Questions

Decisions made on the implementer's behalf, and conflicts between the client contract and the indexed server source. The client contract is normative; conflicts are recorded here, never resolved silently.

**Source-vs-contract conflicts (contract wins; UI hedges as noted):**
1. **`_name` snapshot fields.** The indexed `src/mirrorr/api/schemas.py` shows `SessionResponse` carrying `engine_name`, `resolver_name`, `profile_name`, `recording_progress`, `session_folder`, and `AutorunResponse` carrying `engine_name`/`resolver_name`/`profile_name`/`next_run_at`/`last_run_at`. Client contract §13.12.1 classifies `_name` snapshots as a **non-guaranteed roadmap item**. Resolution per hard constraint (iv): the name memo-map (§13.13) is the primary mechanism; Zod schemas mark all these fields optional and the UI uses them only when present and non-null. If the server stops sending them, nothing breaks.
2. **`recording_progress` on SessionResponse.** Not in the contract's field list. Treated as optional; the remux progress bar is driven by `session.{id}.remux.progress` WS frames (contract §13.4) with the indeterminate 10s fallback — the response field, when present, may seed the bar's initial value.
3. **Index freshness.** `check_index_coverage` reported `no_recorded_issue` for `schemas.py`, `api/ws.py`, `main.py` with freshness `metadata_changed` (reindex recommended). The two facts relied on from the graph — the `_EventsRelay` enrichment shape (skip enrichment on `*.deleted`, `payload["event"]=subject`, `data`=entity) and the response field lists above — are consistent with the client contract, which remains the authority. No other source claims are made.

**Assumptions (chosen reading of underspecified points):**
4. **Remux progress transport** is `/ws/events` (the contract lists the subject in its event table; no separate channel is defined). If frames never arrive, the indeterminate fallback covers it.
5. **Autorun "Run now"** is client-composed `POST /sessions/` (contract §13.10.8) — no invented endpoint.
6. **Autoruns are one-shot** (contract §13.11.1): no recurrence UI anywhere; "spent" is a client-side filter concept only.
7. **Linked-session discovery** on the autorun detail uses cached session pages scanned for `autorun_id` plus the `session.created` WS event, since no backlink endpoint exists (contract §13.11.3 pattern).
8. **Registration for non-first users** lives in the admin Users tab via the admin-gated `POST /auth/register`; the public `/register` route is bootstrap-only. No user-create endpoint is invented (contract §10.1).
9. **Recording playback** is open-in-new-tab only (contract §13.11.5); no embedded `<video>` player, no thumbnails. Reachability is probed once per session on first Open click, not per row.
10. **No bulk export endpoint**: "Export selected" is out of scope for v1; export is per-row (profiles/autoruns) downloading the single-entity bundle.
11. **Dark theme only** in v1 (design direction pinned dark-mode-first; a light theme would require a second token set and is explicitly not specified).
12. **`GET /recordings/{id}` and `GET /notifications/{id}` are unused** — list payloads carry every field the UI renders; noted in the coverage matrix rather than building unused detail views.
13. **Env:** `VITE_API_URL` is the single configuration value; WS URLs derive from it (http→ws, https→wss).
14. **API-client principal UX:** when `AuthResponse.user` is null the bell and its routes are not rendered at all (contract §13.10.3), and the persistent "acting as API client" banner substitutes for notification affordances.
