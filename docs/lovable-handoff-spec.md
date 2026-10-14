# Mirrorr — Lovable.dev Build Handoff

**What this is:** a prompt-ready specification for building a Mirrorr web client in
[Lovable.dev](https://lovable.dev). It is derived from `docs/general-client-specification.md`
(the authoritative feature contract for *any* Mirrorr client) plus the visual direction in
`docs/console-design-spec.md`.

**How to use it:** feed this document to Lovable in the section order below. §1–3 first
(brief, scope, stack), then §4–6 (data, status, design), then §7–8 (screens, flows), then
§9–10 (API + rules). §11–14 are the quality gates and the build order.

**Source of truth:** the backend contract. Where this document and the running server
disagree, the server wins — this document must never invent an endpoint or a field.

---

## 1. Product brief

Mirrorr is a **self-hosted live-stream recorder and scheduler**. An operator defines a
**Profile** (a saved combination of a video *engine* + a URL *resolver* + a retry policy),
then starts a **Session** (a one-shot recording run that starts immediately) or schedules an
**Autorun** (a one-off scheduled recording). The backend runs the capture as a supervised
subprocess: it resolves a URL, runs yt-dlp piped into ffmpeg, produces HLS segments,
optionally remuxes to an `.mp4` **Recording**, and streams live status over a WebSocket.

The client is the **operator console**: authenticate, manage profiles/sessions/autoruns/
recordings, watch live status transitions in real time, inspect plugins, and import/export
configuration bundles. It is a *control deck*, not a media player.

**Who uses it:** a single operator (or small team) running their own recorder on their own
server. Admin users additionally manage users and programmatic API keys.

**Tone of the product:** precise, instrument-like, calm. This is a machine-watching
console; the UI should read like a well-built tool, not a marketing site.

---

## 2. Scope — what to build

Build a complete SPA covering the full feature contract:

- **Auth:** login, first-run register, logout, change password, session refresh.
- **Sessions:** list, create (immediate start), live monitor, detail with attempts timeline, stop, mid-run recording toggle, delete, save-as-profile.
- **Autoruns:** list, create/edit (one-shot schedule), delete, save-as-profile, "run now" sugar.
- **Recordings:** list, detail, delete, open/download link.
- **Profiles:** list, create/edit, delete, "use profile" shortcut.
- **Plugins:** read-only Engines + Resolvers pages, including dynamic config schemas.
- **Import/Export:** export a bundle; import wizard (validate → resolve → apply).
- **Settings:** account (change password), admin Users, admin API clients.
- **Notifications:** bell + unread badge + history drawer.
- **Real-time:** `/ws/events` entity stream + `/ws/notifications` bell feed, with reconnect and polling fallback.

**Explicit non-goals (do NOT build):**

- No recurrence/cron/weekday scheduling — autoruns are **one-shot** (see §10.1).
- No "share"/"make public"/"transfer" — import/export **is** the sharing primitive.
- No user-creation endpoint in admin (self-register + first-user only).
- No media player with guaranteed seeking — recordings are progressive/link-only.
- No plugin authoring — engines/resolvers are read-only introspection.
- No inventing server endpoints for client convenience (e.g. there is no `POST /autoruns/{id}/run`).

---

## 3. Tech stack & conventions

Lovable's default stack, kept as-is:

- **React 18 + TypeScript + Vite**, Tailwind CSS, **shadcn/ui** components.
- **react-router-dom v7** for routing.
- **TanStack Query** for server state (lists, details, mutations).
- **Zustand** for local UI state (dialogs, drawers, filters, toasts).
- **Zod** for parsing every API payload.
- **lucide-react** for icons (stroke icons only — see §6).
- **motion** (framer-motion successor) for the pinned motion tokens.

> **Shipped divergence (2026-10-14):** the built console did not keep this
> stack. It runs **React 19 + TanStack Router** (not `react-router-dom`), has
> **no Zustand** — local UI state lives in component state plus
> `src/api/entity-store.ts` — and uses **Radix primitives** rather than a
> shadcn/ui component package. See `mirrorr-core/ARCHITECTURE.md` §4 for the
> shipped frontend structure.

**Data-layer rule (mock-first):** Lovable previews cannot reach the operator's local
backend. Build the app against a **typed API client** with a **mock adapter**:

```
VITE_API_URL          # e.g. http://localhost:8000
VITE_USE_MOCKS        # "true" in Lovable preview, "false" against a real server
```

- One `src/lib/api/client.ts` with a `request()` helper (adds auth header, parses Zod, throws typed errors).
- One `src/lib/api/mocks/` module returning realistic fixtures (see §10 of the design spec for realistic content) for every endpoint.
- Every query/mutation goes through the client; only the client knows whether it is mock or live.
- The WebSocket layer has a **mock event simulator** that emits realistic status transitions (e.g. `active → recording → terminating → remuxing → finalizing → completed`) on a timer so the live UI is demonstrable in preview.

**Code conventions:** small files (200–400 lines), no `any`, Zod at every boundary, no
mutation of objects (spread/copy), no `console.log` in shipped code, conventional commits
(`feat:`, `fix:`, `refactor:`).

---

## 4. Data model

All timestamps are **naive-UTC strings** unless noted (see §10.2). IDs are integers.

```ts
type Status =
  | "scheduled" | "active" | "recording" | "terminating"
  | "remuxing" | "finalizing" | "completed" | "failed";

type Profile = {
  id: number;
  name: string;
  default_engine_id: number;
  resolver_id: number;
  resolver_config: Record<string, unknown>;
  retry_mode: "none" | "always" | "count" | "exit_code";
  retry_config: Record<string, unknown>;
  requester_user_token: string;
};

type Session = {
  id: number;
  profile_id?: number | null;
  autorun_id?: number | null;
  engine_id: number;
  resolver_id: number;
  resolver_config: Record<string, unknown>;
  retry_mode: string;
  retry_config: Record<string, unknown>;
  status: Status;
  recording: boolean;
  retry_attempts: number;
  started_at?: string | null;   // naive UTC
  ended_at?: string | null;     // naive UTC
  requester_user_token: string;
  session_urls: { label: string; url: string }[];   // often EMPTY — normal
  attempts: Attempt[];
};

type Attempt = {
  index: number;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  exit_code?: number | null;
  reason?: string | null;
};

type Autorun = {
  id: number;
  user_friendly_name: string;
  snake_case_name: string;       // ^[a-zA-Z0-9_-]+$
  profile_id?: number | null;
  engine_id: number;
  resolver_id: number;
  resolver_config: Record<string, unknown>;
  retry_mode: string;
  retry_config: Record<string, unknown>;
  status: Status;                // starts "scheduled"
  start_time: string;            // naive UTC
  end_time: string;              // naive UTC
  recording: boolean;
  requester_user_token: string;
};

type Recording = {
  id: number;
  user_friendly_name: string;
  snake_case_name: string;
  disk_path: string;
  content_url: string;           // may be a dead link by default
  profile_name: string;
  engine_name: string;
  resolver_name: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  size_bytes: number;
  created_at: string;
};

type Engine = {
  id: number;
  name: string;
  description: string;
  origin: string;
  origin_hash: string;
  capabilities: { can_record: boolean; can_stream: boolean };
  retry_modes_schema: Record<string, { schema: JsonSchema; default_params: Record<string, unknown> }>;
};

type Resolver = {
  id: number;
  name: string;
  description: string;
  origin: string;
  origin_hash: string;
  config_schema: JsonSchema;
};

type User = { id: number; username: string; role: "admin" | "user"; display_name: string };
type ApiClient = { id: number; name: string; is_active: boolean; created_at: string };
type Notification = {
  id?: number;                   // absent on WS synthetic frames
  resource_type: "session" | "autorun" | "recording" | "profile";
  resource_id: number;
  event_type: string;
  title: string;
  body?: string;
  read?: boolean;
  created_at: string;
};
```

**List envelope (every list GET):**

```ts
type Page<T> = { items: T[]; next_cursor: number | null; has_more: boolean };
```

**Dynamic JSON Schema** (drives plugin/retry forms — see §10.3): standard JSON Schema
subset — `type` (`string|number|integer|boolean|array|object`), `properties`, `required`,
`default`, `enum`, `minimum`, `maximum`, `items`.

---

## 5. Status system — single source of truth

Define **one** `STATUS_MAP` used by every list, card, badge, row and detail header. Never
hardcode a status colour or label anywhere else. Unknown status strings render as
`unknown` (neutral, no hue) and are logged — never guessed.

| Status key | Label | Tone | Indicator | Dot | Icon (lucide) | Row actions |
|---|---|---|---|---|---|---|
| `scheduled` | Scheduled | primary | blue bar + dot | static | `Clock` | edit, delete, run-now |
| `active` | Running | success | green dot | static | `CirclePlay` | stop, enable/disable recording |
| `recording` | Recording | danger | red filled dot | **pulse** | `Disc` / `CircleDot` | stop, disable recording |
| `terminating` | Stopping… | warning | amber dot | spinner | `CircleStop` | wait, delete |
| `remuxing` | Remuxing | secondary | dark dot | spinner | `RefreshCw` | wait — **delete disabled** |
| `finalizing` | Finalizing | secondary | dark dot | spinner | `PackageCheck` | wait |
| `completed` | Completed | success | green check | static | `CircleCheck` | save-as-profile, delete |
| `failed` | Failed | danger | red ✕ | static | `CircleX` | save-as-profile, delete |
| `unknown` | Unknown | neutral | hollow ring | static | `CircleHelp` | delete |

Binding rules:

- `recording` is the **only** pulsing status. Reduced motion → static dot.
- `remuxing` / `finalizing` bind a spinner and, when `session.{id}.remux.progress` events
  flow, a **determinate progress bar** (percent). If only the status arrived (no progress
  event within ~10s), fall back to an indeterminate spinner — never hang.
- **Icon + word doubling is mandatory** on every status (icon alone is not a status; text
  alone loses scannability). Emoji are banned.
- Colour is never the sole carrier of meaning.

---

## 6. Design direction — "glass control deck"

One line: a **cold-daylight glass control deck** — frosted acrylic chrome floating over the
product's own stream media, with every reading surface opaque, so an operator watches
machines make bytes through a window of etched glass.

**The core law:** *glass owns chrome and overlays; dense reading surfaces are opaque.*
An acrylic surface exists **only** where backdrop media (or the licensed mesh) is visible
behind it. Glass on flat white is a bug.

### 6.1 Tokens (define in `:root`, use everywhere)

```css
:root {
  /* system hues */
  --color-primary: #1856FF;
  --color-secondary: #3A344E;
  --color-success: #07CA6B;
  --color-warning: #E89558;
  --color-danger: #EA2143;
  --color-surface: #FFFFFF;
  --color-text: #141414;
  /* derived: keep hues but clear the ≥3:1 indicator floor / 4.5:1 text floor */
  --color-text-muted: #6E6E6E;
  --color-success-deep: #05A257;
  --color-warning-deep: #C9722F;
  --color-danger-deep: #D01431;

  /* glass mix + edges */
  --glass-chip: rgba(255,255,255,0.55);
  --glass-card: rgba(255,255,255,0.64);
  --glass-modal: rgba(255,255,255,0.72);
  --glass-nav: rgba(255,255,255,0.55);
  --glass-tint: rgba(24,86,255,0.08);
  --glass-border: rgba(255,255,255,0.28);
  --edge-near: rgba(255,255,255,0.35);
  --edge-far: rgba(20,20,20,0.06);
  --glass-shadow: 0 24px 48px -12px rgba(24,86,255,0.18),
                  0 8px 16px -8px rgba(20,20,20,0.12);

  /* blur ladder — two adjacent acrylics never share a step */
  --blur-chip: 8px; --blur-card: 16px; --blur-modal: 24px; --blur-nav: 40px;

  /* scrim ladder (text over media) */
  --scrim-45: rgba(20,20,20,0.45); --scrim-55: rgba(20,20,20,0.55);
  --scrim-65: rgba(20,20,20,0.65); --scrim-75: rgba(20,20,20,0.75);

  /* type */
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --text-h1: 3rem; --text-body: 1rem; --text-label: 0.75rem;

  /* radius — closed set 0/4/8 */
  --radius-none: 0px; --radius-sm: 4px; --radius-md: 8px;

  /* spacing — 4-point grid */
  --space-sm: 8px; --space-md: 16px; --space-lg: 32px; --space-xl: 64px; --gutter: 24px;

  /* luminous edge (top-left light source, always) */
  --luminous-edge: inset 1px 1px 0 var(--edge-near), inset 0 -1px 0 var(--edge-far);

  /* focus ring (two-layer) */
  --focus-ring: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-primary), 0 0 0 5px var(--color-text);

  /* motion — four pinned tokens, never invent numbers */
  --motion-micro: 400 30;   /* spring stiffness/damping */
  --motion-ui: 300 24;
  --motion-page: 350 35;
  --motion-tween-enter: 0.2s ease-out;
}
```

**Typography roles:** `h1` (48/700/-0.02em), `body` (16/400/1.5), `label-caps`
(12px **JetBrains Mono**/500/0.08em uppercase) — the label-caps role lives **only** on
opaque dark chrome and opaque grounds, never on acrylic. Measure caps at 68ch.

**Radius rule:** closed set `0 / 4 / 8` (links 0, buttons/chips/inputs 4, cards/modals/panels 8).

### 6.2 Material recipes (each has an opaque twin)

```css
.acrylic {                     /* ONLY over visible media / mesh */
  background: var(--glass-card);
  backdrop-filter: blur(var(--blur-card)) saturate(1.2);
  background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
  box-shadow: 0 0 0 1px var(--glass-border), var(--luminous-edge), var(--glass-shadow);
  border-radius: var(--radius-md);
}
.opaque {                      /* inside opaque panels, or when backdrop is off */
  background: var(--color-surface);
  box-shadow: 0 0 0 1px var(--glass-border), var(--luminous-edge), var(--glass-shadow);
  border-radius: var(--radius-md);
}
.chrome-dark {                 /* spine, topbar, table headers */
  background: var(--color-secondary);
  color: var(--color-surface);
  box-shadow: var(--luminous-edge);
}
```

Placement table (which material where):

| Region | Material | Alpha | Blur |
|---|---|---|---|
| Nav rail / command capsule | acrylic | 0.55 | 40px |
| Modals, dialogs, drawers | acrylic | 0.72 | 24px |
| Toasts | acrylic | 0.72 | 40px |
| Instrument plates (countdown, tally) | acrylic | 0.64 | 16px |
| Filter/action chips on media | acrylic | 0.55 | 8px |
| Search input (capsule/modal only) | acrylic | 0.72 | 16px |
| **All lists, tables, forms, detail panes, wizards** | **opaque `surface`** | — | none |
| Spine, topbar, table headers | opaque `secondary` | — | none |
| Chips/inputs inside opaque panels | opaque twin | — | none |

### 6.3 Backdrop (z0, fixed, behind everything)

1. **Scrim** — `--color-secondary` at 55% over white, filling the viewport (steps to 65–75%
   under any text that sits on media).
2. **Media**, in order: live session stills (only if `session_urls` non-empty) → recording
   posters (if `content_url` reachable) → **empty-DB default: licensed gradient mesh**:

```css
background-color: #233038;
background-image:
  radial-gradient(120% 90% at 12% 18%, #7FB2C8 0%, transparent 55%),
  radial-gradient(110% 85% at 88% 12%, #E8B48A 0%, transparent 50%),
  radial-gradient(130% 100% at 72% 88%, #0E3B43 0%, transparent 62%),
  radial-gradient(90% 80% at 22% 92%, #5C7A5E 0%, transparent 55%);
```

3. **Parallax** (the one licensed motion): the media layer translates `y: -40px → 40px`;
   acrylic chrome drifts at 0.25× of that.

If the operator disables the backdrop, every acrylic surface swaps to its opaque twin and a
`label-caps` note reads "backdrop off — opaque surfaces".

### 6.4 Shell anatomy (build **one** shell)

Build the conventional **Variant A** anatomy (Lovable renders it well and it is the safer
product choice):

- **Desktop (≥1280px):** floating **acrylic nav rail** on the left (Sessions, Autoruns,
  Recordings, Profiles, Plugins, Import/Export, Settings) + opaque dark **topbar** (breadcrumb
  `MIRRORR › <Section>`, backdrop toggle, primary action, bell, account menu) + opaque
  **content region**.
- **Tablet (768–1279px):** rail collapses to an icon rail.
- **Mobile (<768px):** rail becomes a **bottom tab bar** (opaque dark chrome); primary create
  action becomes a floating action button above the tab bar; the content region is the only
  scroll owner and must clear the tab bar.

Optional alternative (only if asked): the "Experimental" Variant B — a 64px opaque dark
spine + floating glass command capsule + a monitor-wall content region. Do not build both.

### 6.5 Motion inventory (four tokens only)

- Dialog/drawer enter: `--motion-tween-enter`.
- Chip/status change: `--motion-micro`.
- Page/route transition: `--motion-page`.
- The parallax carrier (§6.3).
- All of it respects `prefers-reduced-motion: reduce` (pulse → static, parallax → off).

---

## 7. Screens & routes

Route table (react-router). `/` redirects to `/sessions` (preserving query params).

| Route | Screen | Notes |
|---|---|---|
| `/login` | Login | Also first-run register when `GET /auth/status` → `has_users:false`. |
| `/register` | Register | Admin-gated when users exist. |
| `/sessions` | Sessions list (= home) | Instrument plates + filter + table + empty state. |
| `/sessions/:id` | Session detail | Attempts timeline, live status, actions. |
| `/autoruns` | Autoruns list | Upcoming vs spent. |
| `/autoruns/:id` | Autorun detail | Countdown, config, actions. |
| `/recordings` | Recordings list | Grid/list, open/download. |
| `/recordings/:id` | Recording detail | Metadata, content link. |
| `/profiles` | Profiles list | CRUD. |
| `/profiles/:id` | Profile detail/edit | |
| `/plugins` | Plugins (Engines & Resolvers) | Read-only, capability badges. |
| `/import-export` | Import/Export | Export + import wizard. |
| `/settings` | Settings | Account / Users (admin) / API clients (admin) tabs. |
| `*` | Not found | |

### 7.1 Login / Register

Opaque card on the mesh backdrop. Username + password (register adds display name).
Inline 422 field errors. 429 → "too many attempts, try again shortly" (retryable, not
permanent). 401 → "wrong credentials". On success → `/sessions`.

### 7.2 Sessions list (home)

- **Instrument plates** (acrylic, over the backdrop, above the table): "Live activity"
  (active count, recording count, next start), "Queue" (scheduled count, next run),
  "Vault" (recordings stored, remuxing count, free space if available). Each plate is
  short label-level content only.
- **Toolbar** (opaque): search field (name/engine/profile/id), status filter chips,
  "New session" primary action.
- **Table** (opaque panel): columns — status chip, name/id, engine → resolver, profile,
  started/duration, owner (admin), row actions menu. Rows are clickable → detail.
- **Empty state** (opaque panel): eyebrow "Sessions", "No sessions yet.", body copy,
  primary "New session" + secondary "Open profiles".
- **Loading:** table skeleton. **Error:** `ErrorPanel` with Retry.

### 7.3 Session detail

- Header: status chip + id + engine → resolver + profile + owner; actions per status.
- **Live block:** when `session_urls` non-empty, offer the HLS links; when empty (the
  default) show a calm "Live URLs not configured (operator must set `web_url`)" — never a
  dead player or a spinner.
- **Attempts timeline:** per attempt — index, status, started/ended, exit code, reason.
  "Retry N of M" when `retry_attempts > 0`.
- **Remux progress:** determinate bar during `remuxing` from `session.{id}.remux.progress`.
- Actions: stop (active/recording), enable/disable recording (active), delete (any except
  remuxing), save-as-profile (completed/failed).

### 7.4 Autoruns list / detail

- **List:** search by name; status chips; **visually separate `scheduled` (will run) from
  spent (`completed`/`failed` — will NOT re-arm)**; default filter hides spent.
- **Create/edit wizard:** `user_friendly_name` + auto-slug preview for `snake_case_name`
  (live validation `^[a-zA-Z0-9_-]+$`, manual override); start/end datetime pickers with a
  "your local time, stored UTC" hint; config (profile or direct); recording toggle.
- **Countdown:** tick-granular "T-minus" from `start_time` — do NOT imply second precision
  (scheduler ticks every ~10s).
- Actions: edit (PUT), delete (confirm warns "will also stop any running recording"),
  save-as-profile, "Run now" (client-composed — see §10.4).

### 7.5 Recordings

- Grid/list toggle; per item: name, engine/resolver/profile names, duration (m:ss),
  size (formatted), created date.
- **Open/download** via `content_url` — treat as a link/open-in-new-tab. If it 403/404s,
  show a copy-link + hint ("media not served on this install"), not a broken embed.
- Delete with confirmation (permanent, file removed).

### 7.6 Profiles

- List + search; owner label when admin views others.
- Create/edit dialog: engine picker, resolver picker, **dynamic resolver-config form from
  `config_schema`**, retry-mode picker + **dynamic retry-config form from
  `retry_modes_schema`**.
- "Use profile" row shortcut → prefills the new-session form.
- Delete: pre-scan references and warn "in use by N autoruns/sessions" (server 400s on FK).

### 7.7 Plugins (Engines & Resolvers)

Read-only cards: name, description, `origin_hash` (copyable), capability badges
(`can_record`, `can_stream`). No writes, ever.

### 7.8 Import / Export

- **Export:** per-row Export → downloads a `.json` bundle; multi-select "Export selected"
  (client composes per-entity exports and merges).
- **Import wizard:** file picker → local JSON parse (reject non-`version:1`) →
  `POST /import-export/validate` → **interactive resolution**:
  1. per-item status grid (valid / warnings / errors with issue badges),
  2. plugin-mapping picker for `not_installed`/`hash_mismatch` → builds `plugin_map`,
  3. rename preview for `name_conflict` (`name_2`…`name_199`),
  4. include/exclude toggles → `removed_profiles`/`removed_autoruns`,
  5. Apply → summary toast (`profiles_created`, `autoruns_created`, `skipped`).

### 7.9 Settings

- **Account:** change password (on success → force re-login; server invalidated tokens).
- **Users (admin):** list, delete (pre-empt the "cannot delete last admin" guard).
- **API clients (admin):** create (show the plaintext key **once** in a monospace copy
  field with a one-time warning), list, revoke. Label clearly: "Programmatic access key —
  treat like a password."

### 7.10 Notifications

Bell in the topbar with unread badge; drawer listing history (read/unread, mark-read,
mark-all, delete); click → navigate to the resource. Toasts on crash/completed/failed
(configurable).

---

## 8. Core flows

**8.1 Boot / auth.** `GET /auth/status` → branch login vs register. `GET /auth/me`; on 401
with a refresh cookie → `POST /auth/refresh` once → retry `/auth/me`; if that fails → login
with "session expired". Never loop refresh. Refresh proactively at ~23h. On
`visibilitychange`, re-check `/auth/me`.

**8.2 Create session.** Pick profile (prefill) or set engine+resolver+config directly;
recording toggle (disabled if engine `can_record:false`); retry policy. Submit →
`POST /sessions/` → the session appears immediately as `active` ("Starting…"), then WS
events drive the status. No date/time input (starts immediately).

**8.3 Live monitoring.** On load, HTTP list is the source of truth; WS is the delta layer.
Connect `/ws/events` after auth; upsert on `created/updated` (prefer `payload.data`),
remove on `deleted`; coalesce bursts (~30ms). Reconnect with capped backoff
(1s→2s→…→30s, ~12 attempts), then "live updates offline — polling" fallback. Handle close
codes: `4001` = re-auth/logout, `1013` = retry.

**8.4 Stop / control.** `POST /sessions/{id}/stop` returns `{ok:true}` when the supervisor
*accepted* it. Show "Stopping…" and wait for the authoritative WS event (`terminating` →
`completed`). If no event within ~10s, or on 504/502, offer hard delete. Never trust an
optimistic status after a control action.

**8.5 Recording toggle mid-run.** Optimistic UI + confirm; reconcile with the WS
`session.updated`; surface 400/409 (e.g. mid-remux).

**8.6 Remux → recording.** On `remuxing`, show progress; on `recording.created`, toast
"Recording saved" + offer "Open recording"; invalidate the recordings list.

**8.7 Autorun run-now.** Client-composed: `POST /sessions/` using the autorun's
engine/resolver/config/retry (+`recording`). There is no server run-now endpoint.

**8.8 Import.** See §7.8. **8.9 Notifications.** See §7.10 and §10.6.

---

## 9. API contract (REST + WS)

Base URL `VITE_API_URL` (default `http://localhost:8000`). **Exact paths — no trailing
slashes** (`/auth/users` works, `/auth/users/` 404s). Auth via httpOnly cookie
(`credentials:"include"`), or `Authorization: Bearer <jwt>`, or `X-API-Key`.

### 9.1 Error contract

| HTTP | Meaning | Handling |
|---|---|---|
| 400 | Business rule / duplicate name | inline or toast |
| 401 | Unauthenticated | refresh once, else login |
| 403 | Not owner/admin | hide surface / toast |
| 404 | Not found (or not yours) | empty state |
| 409 | Conflict (e.g. delete a remuxing session) | toast, block action |
| 422 | Validation | map `detail[].loc` to fields |
| 429 | Rate limited (login 10/min, register 5/min, status 30/min) | retryable backoff toast |
| 500 | Unhandled | generic error toast |
| 204 | Success, **empty body** | do not parse |

### 9.2 Endpoint map

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness (public) |
| `GET /auth/status` | `{has_users}` (public) |
| `POST /auth/register` | first-user admin, else admin-gated |
| `POST /auth/login` | JWT cookies (24h access / 7d refresh) |
| `POST /auth/logout` | revoke + clear |
| `POST /auth/refresh` | rotate refresh (JTI) |
| `GET /auth/me` | whoami |
| `POST /auth/change-password` | bump credentials version → force re-login |
| `GET /auth/users` · `DELETE /auth/users/{username}` | admin (last-admin guard) |
| `GET /auth/clients` · `POST /auth/clients` · `DELETE /auth/clients/{id}` | admin (key shown once) |
| `GET/POST /profiles/` · `GET/PUT/DELETE /profiles/{id}` | profiles |
| `GET/POST /sessions/` · `GET/DELETE /sessions/{id}` | sessions (create starts immediately) |
| `POST /sessions/{id}/stop` | stop control |
| `POST /sessions/{id}/recording/enable` · `/disable` | mid-run toggle |
| `POST /sessions/{id}/save-as-profile` | snapshot to profile |
| `GET/POST /autoruns/` · `GET/PUT/DELETE /autoruns/{id}` | autoruns |
| `POST /autoruns/{id}/save-as-profile` | snapshot |
| `GET /recordings/` · `GET/DELETE /recordings/{id}` | recordings (no create) |
| `GET /engines/` · `GET /engines/{id}` | engine introspection (incl. retry schemas) |
| `GET /resolvers/` · `GET /resolvers/{id}` | resolver introspection (incl. config schema) |
| `GET /import-export/profiles/{id}/export` | bundle download |
| `GET /import-export/autoruns/{id}/export` | bundle download |
| `POST /import-export/validate` | dry-run report |
| `POST /import-export/apply` | commit bundle |
| `GET /notifications/` · `GET /notifications/{id}` · `POST /notifications/{id}/read` · `POST /notifications/read-all` · `DELETE /notifications/{id}` | bell history |
| `WS /ws/events` | live entity stream |
| `WS /ws/notifications` | bell feed |

**Lists:** `GET /<resource>/?cursor=<id>&limit=<1..200>` (default 50) →
`{items, next_cursor, has_more}`. Order by `id DESC`; reset cursor on filter change; stop at
`has_more:false`.

### 9.3 WebSocket `/ws/events`

Server-push only. Enriched frames (full entity in `data`; deleted frames carry no `data`):

```json
{ "type":"event", "event":"session.updated", "id":5,
  "status":"recording", "recording":true, "started_at":"...", "ended_at":null,
  "data": { /* full current entity */ } }
```

Event subjects: `session.created|updated|deleted|started|stopped|crashed`,
`autorun.created|updated|deleted`, `recording.created|updated|deleted`,
`profile.created|updated|deleted`. `*.telemetry.*` and `*.control` are never sent.
Prefer `data`; treat top-level fields as hints. `deleted` → remove from cache immediately.

### 9.4 WebSocket `/ws/notifications`

On connect the server flushes all unread, then pushes new frames:

```json
{ "type":"notification", "data":{ "resource_type":"session", "resource_id":5,
  "event_type":"session.crashed", "title":"session 5: session.crashed",
  "created_at":"...", "read":false } }
```

### 9.5 Remux progress

`session.{id}.remux.progress` → `{session_id, percent, eta_seconds?, speed?, time?, frame?}`
(~every 5s). Render as the determinate remux bar.

---

## 10. Critical product rules (the traps)

These are the facts an implementer only learns from the backend. Getting them wrong makes
the UI lie. Treat each as a hard requirement.

**10.1 Autoruns are ONE-SHOT, not recurring.** There is no cron/RRULE/weekday. One
`start_time` spawns exactly one session; when it ends the autorun mirrors `completed`/
`failed` and **never resets to `scheduled`**. Do **not** render recurrence pickers or promise
"repeats weekly". Copy should say "Scheduled recording / one-off timer". Visually separate
*spent* autoruns (will not run again) from `scheduled` ones, and default-filter spent.

**10.2 Naive-UTC time discipline.** `started_at`, `ended_at`, `start_time`, `end_time`,
`created_at`, `exported_at`, `attempts[].started_at/ended_at` are all **naive UTC** (no `Z`).
Send UTC without a tz suffix (tz-suffixed → 422). Render in local time with a tz indicator.

**10.3 Dynamic forms are the single most important generic behavior.** Build
`config_schema` (resolvers) and `retry_modes_schema.<mode>.schema` (engines) into forms
generically: typed inputs, `enum`→select, `default`→prefill, `minimum/maximum`→bounds,
`required`→marker, nested objects→collapsible groups, unknown keys→free key/value editor.
Submit `{...default_params, ...userValues}`. Map 422 `loc` back to fields.

**10.4 No server "run now" for autoruns.** The UI action is client-composed:
`POST /sessions/` with the autorun's `engine_id/resolver_id/resolver_config/retry_*`.

**10.5 `session_urls` empty is a first-class state.** In a default install `web_url` is
unset, so `session_urls` is `[]` forever. Show "live URLs not configured" and disable player
affordances — never spin, never show a dead player.

**10.6 Notifications: two different shapes.** The REST list returns DB rows (`id`, `body`,
`read`); the WS feed sends **synthetic** frames (no `id`, no `body`, no `read`). Treat REST
as history (mark-read/delete) and WS as the live alert stream. **Never join on `id`.**
Notification REST is user-only — API-key clients get 401 (hide the surface for them).

**10.7 API-key-created resources belong to nobody.** A request authenticated by
`X-API-Key` resolves to `user=None`; resources it creates get `requester_user_token: ""`,
**no** WS subscription, and **no** notifications. There is no adopt/transfer endpoint. If
the client is ever operating as an API key, surface this; an admin UI cannot rely on WS to
learn about key-created resources (must poll).

**10.8 Control endpoints are async (5s NATS timeout).** `200 {ok:true}` = *accepted*;
`504` = supervisor not responding (offer delete); `502` = transport error. Reconcile the
optimistic action with the authoritative WS event within ~1s.

**10.9 Delete semantics.** `DELETE /sessions/{id}` on an active session stops it and deletes
**after** cleanup — `session.deleted` arrives seconds later (don't treat 204 as "gone
now"). `DELETE /autoruns/{id}` also stops+deletes any running session (confirm must say so).
`DELETE /profiles/{id}` with FK references → **400** (pre-scan refs). Delete is **disabled**
while `remuxing` (server 409).

**10.10 Editing an autorun is hazardous.** `PUT` updates any field even while it is live,
but the spawned session already captured the old config. **Lock config edits while status ∈
{active, recording, terminating, remuxing, finalizing}** and warn when editing `end_time`
of a live autorun (a past `end_time` triggers a stop on the next tick).

**10.11 Recordings are a flat archive.** `Recording` has no `session_id` backlink — do not
invent one. `content_url` is a static path, not a media API: treat as open/download link,
no guaranteed seeking.

**10.12 Rate limits are per-IP and reset on restart.** Handle 429 as retryable; don't hammer
`/auth/status` in a boot loop.

**10.13 WS `data` can be missing.** Deleted subjects carry no entity, and enrichment can
race a delete — handle "no `data`" by refetching via GET, never crash.

**10.14 Multi-client reality.** Two clients share one server; a local mutation does not make
another client's cache fresh. Always reconcile on WS events; never assume your own calls are
the only source of truth.

---

## 11. Accessibility & responsive floor

- **WCAG 2.2 AA.** Every text/indicator placement measured against its ground; use the
  `-deep` hues for indicator fills on white, scrims (never dulling glass) for text over
  media. Focus ring = the two-layer `--focus-ring`.
- **Keyboard:** all create/edit forms navigable; labels paired with controls; focus
  trapped in dialogs and restored on close; Escape closes overlays.
- **Live regions:** status changes and toasts announced (`aria-live="polite"` for status,
  `assertive` for errors). Every status has an accessible text label (icon + word).
- **Reduced motion:** `prefers-reduced-motion: reduce` → pulses static, parallax off,
  transitions instant. **Reduced transparency** → swap acrylic to opaque twin.
- **Responsive:** 375 / 768 / 1280 breakpoints. Mobile: bottom tab bar; the content region
  is the only scroll owner and must clear the tab bar (verify with a bottom-scroll check —
  the last CTA must not sit under the bar). No horizontal overflow at any width.
- No emoji as icons; stroke icons only (1.75px, 20px on acrylic / 16px in opaque chips).

---

## 12. Build order (milestones for Lovable)

1. **Foundation:** Vite + Tailwind + shadcn + router + Query + Zustand; the token block
   (§6.1), backdrop + mesh, and the shell (§6.4) with an empty content region.
2. **Data layer:** typed API client + Zod schemas + mock adapter + mock WS simulator
   (§3), realistic fixtures.
3. **Auth:** login/register/logout/refresh + route guard + boot flow (§8.1).
4. **Sessions:** list (plates, filter, table, empty) + create dialog + detail + live
   monitor + stop/recording/delete/save-as-profile.
5. **Status system:** the single `STATUS_MAP` (§5) wired through every surface.
6. **Profiles + Plugins:** CRUD + the dynamic schema form engine (§10.3) — the reusable
   widget reused by sessions/autoruns.
7. **Autoruns:** list (scheduled vs spent) + create/edit wizard + countdown + run-now +
   the live-edit locks (§10.10).
8. **Recordings:** list/detail/delete/open-link.
9. **Import/Export:** export + the interactive import wizard.
10. **Settings:** account, admin users, admin API clients (one-time key).
11. **Notifications:** bell + badge + drawer + toasts + WS feed.
12. **Polish:** responsive passes at 375/768/1280, a11y audit, reduced-motion, contrast.

---

## 13. Acceptance checklist

- [ ] Auth flows incl. refresh-once, forced re-login after change-password, register gate.
- [ ] Exact paths / no trailing slash; 204 unparsed; 422 mapped to fields; 429 retryable.
- [ ] Cursor pagination on every list.
- [ ] Dynamic forms built from `config_schema` + `retry_modes_schema` (§10.3).
- [ ] `STATUS_MAP` renders all 7 session + `scheduled` autorun + `unknown` states, icon+word.
- [ ] Naive-UTC in/out discipline (§10.2).
- [ ] Admin-only surfaces hidden for non-admins.
- [ ] Control async reconciled with WS; 504/502 → offer delete (§10.8).
- [ ] Import wizard: validate → plugin_map → rename preview → apply (§7.8).
- [ ] WS reconnect/backoff/close-code handling + polling fallback.
- [ ] Notifications: bell badge, mark-read/read-all/delete, click-to-navigate, two-shape
      handling (§10.6).
- [ ] Delete confirmations: session, autorun (live-run warning), recording, profile
      (in-use warning), user (last-admin guard), API key.
- [ ] API key shown once with copy + warning (§7.9).
- [ ] Autoruns framed one-shot, spent vs scheduled separated, live-edit locks (§10.1, §10.10).
- [ ] `session_urls` empty handled as normal; `content_url` treated as link-only
      (§10.5, §10.11).
- [ ] Responsive at 375/768/1280 with no tab-bar clipping and no horizontal overflow.
- [ ] Reduced-motion + reduced-transparency honored; contrast measured.

---

## 14. Feeding this to Lovable

1. Paste **§1–3** as the first message ("build the foundation and the shell").
2. Paste **§4–6** ("add the data model, status system, and design tokens").
3. Paste **§7–8** ("implement the screens and flows, using mocks").
4. Paste **§9–10** ("wire the API client and enforce these product rules").
5. Use **§12** as the milestone list and **§13** as the review checklist.

**Reminder to the model:** never invent an endpoint, a field, or a status the contract does
not define. When unsure, prefer the mock and leave a comment naming the contract section.
