# Mirrorr — General Client Specification

**Version:** 1.0
**Target:** Any client UI ("client layer") that talks to the Mirrorr Core HTTP/WebSocket API.
**Scope:** The complete, authoritative feature contract — what features must exist, exactly how they must behave, and what the API allows. It deliberately does NOT prescribe UX/UI (that stays with the client).
**Contract source:** `mirrorr-core` v0.1.0 (OpenAPI dump + `src/mirrorr` source verification, Sep 2026).

---

## 0. Architecture Overview

Mirrorr is a self-hosted **live-stream recorder and scheduler**. User creates **Profiles** (a saved combination of a video *engine*, a *resolver*, and retry policy) and **Sessions** (one-shot recording runs) or **Autoruns** (scheduled, recurring recordings). Sessions run as supervisor subprocesses that resolve a URL, start yt-dlp, pipe to ffmpeg, produce HLS segments, optionally remux to a `.mp4` Recording, and stream live status events over a NATS-backed WebSocket.

```
Client UI  ⇄  HTTP REST (CRUD + control + auth + import/export)
            ⇄  WebSocket /ws/events (live entity events)
            ⇄  WebSocket /ws/notifications (bell + unread)
                    │
              [ Mirrorr Core API ]
                    │
              NATS event bus + session supervisor processes
```

**Client responsibilities (everything in this spec).** Client owns:
- Authentication flows (login/register/refresh/logout/change-password)
- CRUD + control of Profiles, Sessions, Autoruns, Recordings
- Plugin (Engine/Resolver) introspection + config forms
- Import/export of bundles
- Users & API-clients administration (admin-only)
- Real-time event stream consumption + notifications
- All UX/UI decisions on top of these features

**Out of scope for this spec:** server infra, plugin internals, HLS/CDN serving.

---

## 1. Transport, Base URL, Errors

### 1.1 Base URL & CORS
- Default `http://localhost:8000`; production behind the operator's proxy.
- In browsers, the client must use the API's declared `cors_allowed_origins` (`VITE_API_URL`). The client must not rely on `document.cookie` for non-same-origin deployment — see 2.3.
- Server never redirects trailing slashes (`redirect_slashes=False`) — **call exact paths**; `/auth/users/` 404s, `/auth/users` works.

### 1.2 Auth modes (all endpoints except listed public)
Every non-public route accepts any one of:
1. **Cookie:** `mirrorr_access_token=<jwt>` (httpOnly, SameSite=Lax, Secure per server config)
2. **Header:** `Authorization: Bearer <jwt>`
3. **Header:** `X-API-Key: <sha256-of-key>`
4. **Query param** `?api_key=<sha256-of-key>` (WS convenience)

### 1.3 Error contract (uniform)
| HTTP | Meaning | Body |
|---|---|---|
| 200/201/204 | Success. 204 = no body. | JSON |
| 400 | Bad request (business rule, integrity, duplicate name) | `{"detail": "A resource with that name already exists."}` etc. |
| 401 | Unauthenticated (bad token/key) | `{"detail": "..."}` |
| 403 | Authenticated but not owner/admin | `{"detail": "Not your <resource>"}` |
| 404 | Not found (or not yours, deliberately) | `{"detail": "..."}` |
| 409 | Conflict (e.g. cannot delete a REMUXING session) | `{"detail":"..."}` |
| 422 | Validation (FastAPI) | `{"detail": [ ...field errors... ]}` or custom `{"detail":"Invalid data format provided for update.","errors":[...]}` |
| 500 | Unhandled | `{"detail":"Internal server error"}` |

- **Client must render 422 detail arrays** (loc + msg) inline per field. Example field error:
```json
{"type":"missing","loc":["body","engine_id"],"msg":"Field required"}
```

### 1.4 Pagination (all list GETs)
`GET /sessions/?cursor=<id>&limit=<1..200>` (default 50).
Response envelope: `{"items":[...], "next_cursor": <int|null>, "has_more": <bool>}`.
- Cursor = id of last item on the previous page; server orders by `id DESC` (newest first is *not* guaranteed — client must sort by `id` or its own fields).
- `has_more: true` → fetch `?cursor=next_cursor` for the next page (infinite scroll / "load more").

---

## 2. Authentication & Account (`/auth/*`)

Public: `POST /auth/status`? No — **`GET /auth/status`** is public. Everything else requires auth. All responses:

```json
{"user": {"id":1,"username":"admin","role":"admin","display_name":"Admin"}, "client": null}
```

`AuthResponse.user` always present; `.client` present only if authenticated via API-key client.

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /auth/status` | public | `{"has_users": bool}` — client uses to branch to register vs login |
| `POST /auth/register {username,password,display_name?}` | public (first user only), else admin | First user → admin. Subsequent requires admin. Sets access+refresh cookies. |
| `POST /auth/login {username,password}` | public | Sets `mirrorr_access_token` (24h) + `mirrorr_refresh_token` (7d) cookies. 401 on bad creds. |
| `POST /auth/refresh {}` | cookie/body | Rotates refresh token (JTI). **If a used/revoked token is presented → revoke ALL user refresh tokens (security).** Returns fresh `AuthResponse` + sets cookies. |
| `POST /auth/logout` | auth | Revokes current refresh JTI, clears cookies. |
| `GET /auth/me` | auth | Current `AuthResponse`. |
| `POST /auth/change-password {old_password,new_password}` | auth | Validates old, bumps `credentials_version` → **all existing access tokens become invalid** (client must force re-login). |
| `GET /auth/users` | admin | List `UserResponse[]`. |
| `DELETE /auth/users/{username}` | admin | 400 if last admin. Cascades cleanup. |
| `GET /auth/clients` | admin | List API clients `{id,name,is_active,...}` (no key plaintext). |
| `POST /auth/clients {name}` | admin (or bootstrap) | **Returns plaintext API key ONCE** `{id, name, api_key_hash, plaintext_key}` — client must display it immediately (copy button) and warn it won't be shown again. |
| `DELETE /auth/clients/{id}` | admin | Removes client (GET-only clients lose access). |

### 2.1 Client requirements — Authentication flow
1. On app load: `GET /auth/me`. If 401 → show login.
2. If refresh cookie exists and `/auth/me` 401s → `POST /auth/refresh`, then retry `/auth/me` once.
3. If refresh fails → redirect to login.
4. On login success → navigate to app home.
5. **Expiry UX:** access token ~24h; refresh ~7d. Client should proactively refresh *before* expiry (e.g. on 401 or at 23h mark) and surface "session expired" gracefully with a re-login screen — do NOT silently loop.
6. Registration screen: if `/auth/status` = `has_users:false` → "Create first admin account". If true → registration form with admin gate (server will 403 if not admin; client should only show it in admin area).
7. Change password: after success, force re-login (server invalidated tokens).
8. **API clients admin panel** (admin): create (show key once), list, revoke. Must label keys as "API client" and warn that keys grant full-scope resource access as a non-human user (see 10.2 for scope).

### 2.2 Client requirements — persistent session
- Use httpOnly cookies in browser (no XSS-exfiltration). Non-browser clients store JWT securely.
- `credentials: "include"` where cross-origin.

---

## 3. Profiles (`/profiles/*`)

A Profile is a **named, reusable recording configuration**: a saved snapshot of `engine + resolver + resolver_config + retry_mode + retry_config`. Sessions/Autoruns may reference a profile or be fully self-contained.

**`ProfileResponse`:** `{id, name, default_engine_id, resolver_id, resolver_config, retry_mode, retry_config, requester_user_token}`

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /profiles/` | auth | Paginated |
| `POST /profiles/ {name, default_engine_id, resolver_id, resolver_config?, retry_mode?, retry_config?}` | auth | Validates engine/resolver exist. `resolver_config` validated against resolver's `config_schema` (server rejects invalid → 422 with loc). 400 on duplicate name. Sets `requester_user_token=current user`. Emits `profile.created`. |
| `GET /profiles/{id}` | auth | Enriched ProfileResponse. |
| `PUT /profiles/{id}` | auth | Partial update (exclude-unset). Same validation. |
| `DELETE /profiles/{id}` | auth+owner | 204. Fails if referenced by autoruns/sessions (FK) → 400. |

### 3.1 Client requirements — Profiles
- **List** with pagination, search/filter by name.
- **CRUD** dialog/form with:
  - Engine picker (from `GET /engines/`), resolver picker, dynamic resolver-config form **generated from `config_schema`** (fields + types + default + required; see 8).
  - Retry mode picker + dynamic config form **generated from engine's `retry_modes_schema`**.
  - Owner label: `requester_user_token` shown if admin viewing others.
- **"Use profile" shortcut** on each row → pre-fills new Session/Autorun form with profile's engine/resolver/config (one-click).
- **Duplicate protection:** creating with same name → client should pre-flag; server errors 400.

---

## 4. Sessions (`/sessions/*`)

A **Session** = one live recording attempt (usually one-shot; may be tied to an autorun).

**`SessionResponse`:** `{id, profile_id?, autorun_id?, engine_id, resolver_id, resolver_config, retry_mode, retry_config, status, recording, retry_attempts, started_at?, ended_at?, requester_user_token, session_urls: [], attempts: []}`

**`status`: `active | recording | terminating | remuxing | finalizing | completed | failed`** (string enum — client must map & render all).

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /sessions/` | auth | Paginated |
| `POST /sessions/ {profile_id? | engine_id, resolver_id, resolver_config?, retry_mode?, retry_config?, recording?}` | auth | Create **immediately starts** supervision. `recording` defaults false. Emits `session.created`. `requester_user_token` = current user. |
| `GET /sessions/{id}` | auth | Enriched. |
| `DELETE /sessions/{id}` | auth | **204.** 409 if status==`remuxing` (forbidden — remux can't be interrupted). If active/recording → sends stop control (`session.stop_requested`) then deletes after cleanup. |
| `POST /sessions/{id}/stop` | auth+owner | Sends `stop` control; supervisor finalizes (completed) instead of failed. |
| `POST /sessions/{session_id}/recording/enable` | auth+owner | Mid-run: flips `recording=true`, status→`recording`, starts stash. |
| `POST /sessions/{session_id}/recording/disable` | auth+owner | Flips `recording=false`, status→`active`, stops stash. |
| `POST /sessions/{session_id}/save-as-profile {name}` | auth+owner | Copys session's engine/resolver/config/retry into a new Profile. |

**Attempts:** `session.attempts` is a list; each element reflects one resolver-join/engine-start cycle. `retry_attempts` counts retries.

### 4.1 Client requirements — Sessions
- **Start session** form: pick Profile (prefill) or set engine+resolver+config directly; recording toggle; retry policy. Date/time NOT needed (immediate).
- **Live monitor:** card/row per session reflecting status transitions via WS (see 11) — colors/icons per status:
  - `active` (running, not recording) · `recording` · `terminating` (stop requested) · `remuxing` (finalizing media — show spinner, disable delete) · `finalizing` · `completed` (green, done) · `failed` (red, error summary from attempts).
- **Actions per status:** stop (active/recording), enable/disable recording (active), delete (any except remuxing), save-as-profile (completed/failed).
- **Detail view:** attempts timeline (per attempt: status, started/ended, exit code), `session_urls` → HLS links (open in player; **only populated when operator sets `web_url`** — if empty, show "live URLs unavailable" with hint), duration (from started_at→ended_at), owner.
- **Auto-refresh:** prefer WS events + `GET /sessions/{id}` on important transitions; fallback poll every 10–30s when WS down.
- **Recording toggle:** optimistic UI + confirm; surfaces server 400 if mid-remux etc.

---

## 5. Autoruns (`/autoruns/*`)

Scheduled sessions; the client schedules these at fixed local times, server executes.

**`AutorunResponse`:** `{id, user_friendly_name, snake_case_name, profile_id?, engine_id, resolver_id, resolver_config, retry_mode, retry_config, status: scheduled|active|recording|terminating|remuxing|finalizing|completed|failed, start_time, end_time, recording, requester_user_token}`

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /autoruns/` | auth | Paginated |
| `POST /autoruns/ {user_friendly_name, snake_case_name, profile_id? | engine_id, resolver_id, ..., start_time, end_time, recording?}` | auth | `snake_case_name` must match `^[a-zA-Z0-9_-]+$`. `start_time`/`end_time` naive-UTC ISO (no tz — client must send UTC, strip tz). 400 duplicate snake name. Emits `autorun.created`. |
| `GET /autoruns/{id}` | auth | |
| `PUT /autoruns/{id}` | auth+owner | Partial update (name, times, config...). `exclude_unset`. |
| `DELETE /autoruns/{id}` | auth+owner | 204. Stops currently-running associated session and deletes it. |
| `POST /autoruns/{autorun_id}/save-as-profile {name}` | auth+owner | New Profile from autorun's config. |

**Time semantics (IMPORTANT):** `start_time`/`end_time` are **naive UTC datetimes** (server strips tz). Client MUST:
- Send UTC (convert from local tz), no tz suffix (`2026-09-07T08:00:00`).
- Store/render in local time — convert retrieved naive-UTC to local for display via configured tz.

### 5.1 Client requirements — Autoruns
- **List** (upcoming/past), search by name, status chips.
- **Create/edit wizard:**
  - Name (both `user_friendly_name` + auto-slug preview for `snake_case_name`, with manual override + live validation `^[a-zA-Z0-9_-]+$`).
  - Start + end datetime pickers (UTC aware — show "your local time, stored UTC").
  - Config (profile or direct — same engine/resolver/retry widgets as Session).
  - Recording toggle default true.
- **Scheduling UI:** "next run" computed client-side from start_time; countdown; overlap? (server allows multiple — client SHOULD warn on overlapping autoruns and disallow end<start).
- **Status layout:** like sessions + `scheduled` (upcoming, no process).
- **Actions:** edit (PUT), delete (confirm: "will also stop any live run"), save-as-profile, and a **"Run now"** convenience that creates a session from the same config (client-composed: `POST /sessions/` with autorun's engine/resolver/config) — note: this is client sugar; no server "run now" endpoint.

---

## 6. Recordings (`/recordings/*`)

Completed `.mp4`s produced from sessions with `recording=true`.

**`RecordingResponse`:** `{id, user_friendly_name, snake_case_name, disk_path, content_url, profile_name, engine_name, resolver_name, started_at, ended_at, duration_seconds, size_bytes, created_at}`

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /recordings/` | auth | Paginated |
| `GET /recordings/{id}` | auth | |
| `DELETE /recordings/{id}` | auth | 204, removes file+row. Emits `recording.deleted`. |

No POST/PUT — recordings are created by the system (remux finalize).

### 6.1 Client requirements — Recordings
- **Grid/list** with thumbnail? — content_url points to HLS/video asset; client may embed `<video>` / preview, show `size_bytes` formatting, `duration_seconds` (format m:ss), engine/resolver names, timestamps.
- **View/play** via `content_url` (server serves if `dev_serve_files` or operator-proxied — if 403/404, client shows link + hint).
- **Delete** with confirmation (permanent, file gone).
- **Export** — recordings themselves aren't in bundles (bundles are configs — 9). Client can offer "download file" via content_url when reachable.

---

## 7. Control channel semantics (shared by sessions)

`POST /sessions/{id}/stop|recording/enable|recording/disable` are **asynchronous** — they send a NATS control request to the supervisor (timeout 5s):
- 200 `{"ok": true}` — command accepted.
- 400 — server says `error` reply (e.g. enable while remuxing).
- 502/504 — NATS unreachable/supervisor not responding (supervisor likely dead) — client should surface "control unavailable; session may be stuck — consider delete".

The WS event stream mirrors the supervisor's actual state transitions, so **UI must reconcile optimistic action with authoritative event** (e.g. press Stop → show "stopping…" until `session.stopped` or status `completed` arrives; if neither arrives within ~10s, offer hard delete).

---

## 8. Plugins: Engines & Resolvers (`/engines/*`, `/resolvers/*`)

Engine = media fetcher (e.g. `yt_dlp_piped` — yt-dlp → ffmpeg → HLS). Resolver = URL source (e.g. `static`).

**`EngineResponse`:** `{id, name, description, origin, origin_hash, capabilities: {can_record, can_playlist}, retry_modes_schema}`

**`ResolverResponse`:** `{id, name, description, origin, origin_hash, config_schema}`

| Endpoint | Auth |
|---|---|
| `GET /engines/`, `GET /engines/{id}` | auth |
| `GET /resolvers/`, `GET /resolvers/{id}` | auth |

No POST/PUT/DELETE — plugins are discovered from disk on boot (custom plugin dev is out of client scope).

### 8.1 Dynamic form schema (client MUST implement)
- `retry_modes_schema`: `{ "<mode>": { "schema": <JSON Schema>, "default_params": {...} } }` for modes `none|always|count|exit_code`. Example:
```json
{
  "always": {
    "schema": {"type":"object","properties":{},"title":"RetryAlways"},
    "default_params": {}
  },
  "count": {
    "schema": {"type":"object","properties":{
      "count":{"type":"integer","default":3,"minimum":1},
      "delay":{"type":"number","default":5.0,"minimum":0}},
      "required":[]},
    "default_params":{"count":3,"delay":5.0}
  },
  "exit_code": {
    "schema": {"type":"object","properties":{
      "codes":{"type":"array","items":{"type":"integer"},"default":[1]},
      "delay":{"type":"number","default":5.0,"minimum":0}},
      "default_params":{"codes":[1],"delay":5.0}}
  }
}
```
- `config_schema` (resolvers): JSON Schema describing the resolver's accepted config (e.g. `{url: string, headers: object}` with `required:["url"]`).
- **Client must render these JSON Schemas as forms generically**: fields for each property in `schema.properties`, honoring `type` (string/number/integer/boolean/array/object), `default`, `minimum`/`maximum`, `enum`, `required` (marker + validation), nested objects as collapsible groups. On submit, build `config`/`params` from fields, falling back to `default_params`.
- Capabilities badge: e.g. engine `can_record` false → disable recording toggle with tooltip.

### 8.2 Client requirements — plugin surfaces
- **Engines/Resolvers admin page**: cards with name, description, origin_hash (copyable), capabilities badges; read-only.
- Dynamic config editors reused across Profile/Session/Autorun forms (single shared widget).

---

## 9. Import / Export (`/import-export/*`)

Bundle = portable JSON snapshot of Profiles + Autoruns (config only, not media).

| Endpoint | Auth | Payload |
|---|---|---|
| `GET /import-export/profiles/{id}/export` | auth+owner | → `{"version":1, "exported_at":<naive-utc>, "profiles":[...], "autoruns":[]}` |
| `GET /import-export/autoruns/{id}/export` | auth+owner | Same, with autoruns populated (embedded profile). |
| `POST /import-export/validate` | auth | Body = **raw bundle object** (not wrapped) `{version, profiles?, autoruns?}`. → per-item `{name, content_hash, valid, issues: [{problem: not_installed|hash_mismatch|already_exists|name_conflict|profile_missing|engine_override|...}]}` |
| `POST /import-export/apply` | auth | `{bundle, plugin_map: {<origin_hash>: {type:"engine"|"resolver", id}}, removed_profiles?: [names], removed_autoruns?: [names]}` → `{profiles_created, profiles_skipped, autoruns_created}` |

**Bundle shape (profile):**
```json
{
  "name": "p2",
  "default_engine": {"name":"yt_dlp_piped","origin_hash":"6e57..."},
  "resolver": {"name":"static","origin_hash":"f1c2..."},
  "resolver_config": {...},
  "retry_mode": "none",
  "retry_config": {},
  "content_hash": "4494..."
}
```
Issue semantics the client must render:
- `not_installed` / `hash_mismatch` → user must map bundle's engine/resolver to an installed one via `plugin_map` (picker per item).
- `already_exists` (same content_hash) → skip (import as-is, no dup).
- `name_conflict` → auto-rename `name_2`..`name_199` (client should preview/confirm).
- `profile_missing` / `engine_override` (autorun's engine differs from its profile) → resolve.

### 9.1 Client requirements — Import/Export
- **Export:** per-profile/autorun "Export" button → downloads `.json` bundle; plus multi-select "Export selected" (client composes by calling export per entity and merging — no bulk endpoint; OR single-export chaining).
- **Import:** file picker → parse JSON → `validate` → **interactive resolution wizard**:
  1. Show per-item status grid (valid / warnings / errors).
  2. Resolve plugin mappings (each unresolved engine/resolver → dropdown of installed alternatives, default = matching origin, else `not_installed`).
  3. Preview renames for name_conflicts; toggle include/exclude per item (`removed_profiles`/`removed_autoruns`).
  4. Apply → summary toast (`profiles_created`, `autoruns_created`, `skipped`).
- **Validation UX:** refresh validation live as mappings change (re-call `validate` with updated plugin_map? — actually validate is fixed-bundle; apply accepts the map — **client should call `validate` once for the report, then construct `plugin_map` + apply**; re-validate only needed if bundle edited).
- Schema check: reject non-`version:1` bundles with clear message.

---

## 10. Users & API clients (admin)

### 10.1 Users
- List (`GET /auth/users`), delete (`DELETE /auth/users/{username}`) — **block deleting the last admin** (server 400; client must preempt with confirm-state).
- No create-user endpoint in API (only self-register + first-user) — client must **not** invent one; admin management = delete + password reset is not in API (change-password is self-service only).

### 10.2 API clients
- Full CRUD-lite: create/list/delete. Scope is **not granular** — a client key is a principal with the same per-resource owner-scoping as a user, but no `.user` (so it can see only resources it created / it gets `client` in AuthResponse).
- Client UI must label clearly: "Programmatic access key — treat like a password".

---

## 11. Real-time: WebSocket Event Stream

Two endpoints, both **server-push only** (client never sends data; ping/heartbeat client-side).

### 11.1 `/ws/events` — entity events
Auth: cookie / `X-API-Key` / `Authorization: Bearer` / `?api_key=`.
Server filters to the user's **subscribed resources** (auto-subscribed to resources they create; unauthenticated relays all — but the endpoint requires auth, so effectively: own resources + admin sees all).

Frame (as actually emitted by the relay): the server **enriches** every non-delete event with the full current entity from the DB, replacing the original `data`:
```json
{"type":"event","event":"session.updated","id":5,
 "status":"recording","recording":true,"started_at":"...","ended_at":null,
 "data":{ <full current Session object, mode="json" — superset of the bare event fields> }}
```
The `event` field = the NATS subject; `id`/`status`/`recording`… are the *original* emitted fields (kept at top level), and `data` is the **enriched full entity**. Deleted events (`session.deleted` etc.) carry **no** `data` (only `id`) — the relay skips enrichment for them. Clients must prefer `payload.data` (authoritative snapshot) and treat top-level fields as hints.

**Event catalog (subjects):**
`session.created|updated|deleted|started|stopped|crashed`
`autorun.created|updated|deleted`
`recording.created|updated|deleted`
`profile.created|updated|deleted`

**Server skips** (never sent): `*.telemetry.*` (proc telemetry 1Hz — too noisy), `*.control`, `_INBOX.*`.

Rules:
- `updated` fires on any field change (incl. status) — client should coalesce.
- `deleted` events have NO entity payload (only `id`); client must remove from cache immediately.
- `started/stopped/crashed` are lifecycle mirrors of `updated` with status change — client may treat them as hints to refetch detail or render banners ("Session 5 crashed").

**Client requirements:**
1. Connect on app load (after auth). Auto-reconnect with capped exponential backoff (e.g. 1s→2s→...→30s), max ~12 attempts, then surface "live updates offline — polling" and fall back to `GET` polling.
2. Handle close codes: `4001` = auth required → log out / re-auth; `1013` = server temporarily unavailable → retry with backoff.
3. Cache coherence: on `created/updated` → upsert cache entry (Zod-validate, invalidate query on mismatch); on `deleted` → remove.
4. Batch/coalesce bursts (e.g. 30ms microtask flush) to avoid re-render storms.
5. Never block on WS — HTTP CRUD remains source of truth for initial load; WS is delta layer.

### 11.2 `/ws/notifications` — bell feed
Auth: same four. On connect server flushes **all unread notifications**, then pushes new ones.

Frame:
```json
{"type":"notification","data":{
   "resource_type":"session","resource_id":5,"event_type":"session.crashed",
   "title":"session 5: session.crashed","created_at":"...", "read":false}}
```

**Client requirements:**
1. Bell + unread count badge (receive on connect, decrement on read).
2. Toast on important events (crash, completed, failed) — configurable.
3. Drawer/history: list with read/unread state, mark read (`POST /notifications/{id}/read`), mark-all (`POST /notifications/read-all`), delete (`DELETE /notifications/{id}`), clear.
4. Click notification → navigate to the resource (session/autorun/recording/profile detail).

### 11.3 Notifications REST
`GET /notifications/` (list, own), `GET /notifications/{id}`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}`. All user-scoped; 404 if not owner.

---

## 12. Cross-cutting client requirements

### 12.1 Data layer / caching
- All list/detail data cached with optimistic updates; WS is the delta engine (invalidate on mismatch).
- Pagination preserved across invalidations (cursor-based — keep `next_cursor`, `has_more`).
- Central API client with typed response (Zod parse of every payload — server sometimes omits/alters fields; parse → fallback invalidate → refetch).

### 12.2 Status mapping — single source of truth
Client MUST define one reusable status→(label, color/icon, action-set) map used across lists, cards, badges:
```
scheduled   → "Scheduled"   (blue)      [edit, delete, run-now]
active      → "Running"     (green)     [stop, enable/disable rec]
recording   → "Recording"   (red pulse) [stop, disable rec]
terminating → "Stopping…"   (amber)     [wait, delete]
remuxing    → "Remuxing"    (purple)    [wait — delete disabled]
finalizing  → "Finalizing"  (purple)    [wait]
completed   → "Completed"   (green ✓)   [save-as-profile, delete]
failed      → "Failed"      (red ✕)     [save-as-profile, delete]
```
Engine capabilities gate recording toggles. **No client-side invention of statuses** — unknown status string → render "unknown" + log.

### 12.3 Time handling
- Display: always local time, formatted with tz indicator for naive-UTC fields (`started_at`, `ended_at`, `start_time`, `end_time`, `created_at`, `exported_at`).
- Inputs: local-time pickers with explicit "converts to UTC on save" hint; server rejects tz-suffixed values (422).
- Duration: `duration_seconds` on recordings; sessions derive from started/ended.

### 12.4 Responsive/accessibility floor (recommended, not prescribed UI)
- Keyboard-navigable create/edit forms; labels paired with controls; focus management on dialogs.
- Reduce motion respected for pulses/spinners.
- All icons accompanied by text where space allows (status-only rows get title attributes).

### 12.5 Health & connectivity
- `GET /health` → `{"status":"ok"}` — client should surface "API offline" banner when unreachable.
- `GET /favicon.ico` exists (204) — ignore.

---

## 13. Behavioral Wire Contract — every request, response, trigger, timing

This section is the **wire-level behavioral contract** that complements the endpoint tables in 2–11. For each feature area it states: what the client sends, exactly what the server answers (and why), *what causes each response*, *when the client should expect it*, *with what data*, and — derived from that — which **UI affordances are possible** (error toasts, loading spinners, progress bars, live updating elements, optimistic states, etc.). It is normative: if a client's UX contradicts a "must" here, the client is wrong.

Legend for "affordances": 🛑 = possible error-toast/inline error, ⏳ = spinner/loading state, 📶 = progress bar/percent, 🔄 = live-updating element (WS or poll), ✅ = success toast/inline success, 🧹 = cache invalidation/refetch.

---

### 13.1 Authentication & session lifecycle

| Step | Client sends | Server answers | Why / when | UI affordance |
|---|---|---|---|---|
| App load | `GET /auth/me` | 200 `AuthResponse` **or** 401 `{"detail":"..."}` | Immediate; every boot & after refresh | 🔄 who-am-I; 🛑 401 → route to login |
| Refresh | `POST /auth/refresh` (cookie/body) | 200 fresh `AuthResponse`+cookies **or** 401 (refresh invalid/revoked) | Called when `/auth/me` 401s; also proactively at ~23h (access TTL 24h). **JTI rotation** — every call invalidates the previous refresh token | 🔄 silent re-auth; 🛑 401 after refresh → full logout; never infinite retry loop |
| Login | `POST /auth/login {username,password}` | 200 `AuthResponse`+cookies **or** 401 invalid creds / 429 rate-limited (in-memory, per-IP, window) | On form submit; 429 = "too many attempts" toast | ⏳ spinner on submit; 🛑 401 "wrong credentials", 429 "try again later"; ✅ success → navigate |
| Register | `POST /auth/register {username,password,display_name?}` | 200 `AuthResponse`+cookies **or** 400 "username taken" / 403 "not admin" / 422 validation | First user (bootstrap) or admin-invited | ⏳ spinner; 🛑 inline field errors from 422 `detail[]`; ✅ → logged in |
| Logout | `POST /auth/logout` | 200 (revokes refresh JTI, clears cookies) | Explicit user action | 🧹 clear cache; navigate to login; no error expected |
| Change password | `POST /auth/change-password {old_password,new_password}` | 200 **or** 400 "old password incorrect" | Explicit action; **on success server bumps `credentials_version` → ALL existing access tokens invalid** | ✅ "password changed — please sign in again"; 🛑 400 old-password error; force re-login |
| `GET /auth/status` | — | `200 {"has_users": bool}` | On app boot to decide register-vs-login screen; **rate-limited per-IP (429 possible)** | ⏳ boot splash; 🛑 429 → treat as "has_users" unknown |

**Concrete example — session-expiry dance:**
```text
1. App boots → GET /auth/me → 401
2. Client has refresh cookie → POST /auth/refresh → 200 → retry GET /auth/me → 200
3. (Only if refresh also 401) → clear local state → redirect to /login with toast "Session expired"
```
Never loop step 2 more than once per boot, and never re-attempt refresh after a *used-token* 401 (the server revokes **all** refresh tokens for the user on reuse — a loop would force the user off).

| Affordance summary (auth) | Use when |
|---|---|
| 🛑 toast "session expired" | refresh chain fails |
| 🔄 `GET /auth/me` refresh on visibilitychange/focus | catch token expiry while tab backgrounded |

---

### 13.2 Sessions — full lifecycle wire contract

**Create (immediate start):**
| Event | Detail |
|---|---|
| Client sends | `POST /sessions/ {profile_id? \| engine_id, resolver_id, resolver_config?, retry_mode?, retry_config?, recording?}` |
| Server does | Validates FK + config; inserts row (`status=active`, `requester_user_token=you`); `subscribe_requester` (so your WS gets its events); emits `session.created` on NATS → your `/ws/events` gets `session.created` + enriched entity |
| 200 body | Full `SessionResponse` (status `active`, `retry_attempts:0`, `attempts:[]`, `session_urls:[]`, `started_at:null`) |
| Errors | 400 duplicate name/IntegrityError; 409 conflict; 422 validation (incl. invalid engine/resolver IDs) |
| When expected | Within ~1 round-trip; the supervisor spawn happens async — **session is `active` immediately, before any process actually starts** |

**Live status sequencing (what the client sees over WS after create):**

| Time | WS event | Session state | Client UX (allowed affordance) |
|---|---|---|---|
| t+0ms | `session.created` (enriched) | `active`, retry_attempts 0, attempts [] | 🔄 row appears as "Starting…" (status active); ⏳ if you show a detail view |
| t+ε | `session.updated` | `status=recording` (if `recording:true`) or stays `active`; `attempts:[{index:1, started_at:..., ended_at:null,...}]`; `session_urls:[...]` if `web_url` configured (`[{label:"M3U8"|"HTML"|"Outplayer",url:...}]` — empty list otherwise) | 🔄 live status chip flips; 🔄 attempt list shows attempt 1 "running"; 🔄 HLS player can mount from the M3U8 `session_urls` entry — but if `web_url` unset the list is empty and the client must show "live URLs unavailable" instead of a dead player |
| during | `session.updated` on retry-attempt boundary | `retry_attempts` increments, `attempts` appends | 🔄 attempt timeline grows; "retry N of M" indicator |
| stop pressed | (client) `POST /sessions/{id}/stop` → 200 `{"ok":true}`; then server emits `session.updated` `status=terminating` | `terminating` | 🔄 "Stopping…" chip; disable stop button; 🛑 504 (supervisor unresponsive) → offer hard-delete |
| done | `session.updated` `status=completed` (or `failed`); then `session.stopped`/`session.crashed` | `completed`/`failed`, `ended_at` set | ✅ "Completed" toast (configurable); 🔄 final chip; 🧹 refetch detail |
| crash | `session.crashed` (+ `session.updated` status=`failed`) | `failed`, `reason` in attempts | 🛑 "Session failed/crashed" toast with reason; 🔄 attempts detail |

**Every `session.updated` = full serialized entity** (enriched by server). Client MUST coalesce rapid bursts (e.g. attempt-start + status-change arrive back-to-back) — use a microtask/30ms batcher.

**Recording toggle mid-run:**
| Action | Client sends | Replies / events |
|---|---|---|
| Enable recording | `POST /sessions/{id}/recording/enable` | 200 `{"ok":true}` → WS `session.updated` `status=recording`, `recording=true`. **409/400** if e.g. already recording or supervisor refuses (status not `active`) — 🛑 toast |
| Disable recording | `POST /sessions/{id}/recording/disable` | 200 `{"ok":true}` → WS `session.updated` `status=active`, `recording=false` |
| Delete | `DELETE /sessions/{id}` | **204** (body empty). If `status=remuxing` → **409** "can't delete while remuxing"; if active → server sends stop control, finalizes, then deletes (client sees `session.deleted` WS event after) |

**Critical timing facts for UI:**
- The control endpoints are **asynchronous NATS requests with 5s timeout**: 200 = supervisor *accepted*; **504** = supervisor not responding (dead/stuck); **502** = transport error. 🛑 504/502 = "control unavailable — session may be stuck"; offer delete.
- The authoritative state is **always the last WS event / latest `GET /sessions/{id}`** — never trust a read-only optimistic status after a control action; reconcile within ~1s (supervisor emit is near-instant) or surface "still stopping…".

**Affordance summary (sessions):** ⏳ create spinner; 🔄 live chip + attempt timeline + HLS player; 🛑 control 504/502/409 toasts + delete-confirm dialog with "will stop live run" warning; 🧹 invalidate list on create/delete; ✅ "session completed".

---

### 13.3 Autoruns — scheduling wire contract

| Step | Client sends | Server answers | When / why |
|---|---|---|---|
| List | `GET /autoruns/?cursor=&limit=` | Paginated `AutorunResponse[]` | Initial load + after imports |
| Create | `POST /autoruns/ {user_friendly_name, snake_case_name, ...}` | 200 `AutorunResponse` (`status=scheduled`) **or** 400 duplicate `snake_case_name` / 422 (bad name chars, tz-suffixed times) | Form submit |
| Update | `PUT /autoruns/{id}` | 200 updated `AutorunResponse` **or** 400/422 | Edit form; `exclude_unset` — only sent fields change |
| Delete | `DELETE /autoruns/{id}` | **204** — **if a live session exists for it, server stops + deletes that session too** | Confirm dialog MUST warn "this stops any running recording"; 🛑 if admin-only etc. |
| Trigger at start_time | (server, async) | Creates a `Session` linked via `autorun_id`, sets `autorun.status=active`, emits `autorun.updated` + `session.created` | Happens **without client action** — client UI should show countdown from `start_time` and react to the spawn event: 🔄 list flips to `active`, new session appears |
| Completion | (server, async) | `autorun.status` → `completed`/`failed` mirroring the session; emits `autorun.updated` | 🔄 chip flips; 🛑 toast on failure |

**Timing contract for the client:**
- `start_time`/`end_time` are in the past → server **still creates the session** (it acts as an immediate trigger; no rejection). Client should *pre-validate* `end>start` and warn on past values, but never hard-block (server allows backfill).
- Between `start_time` and the spawn event there is **no guarantee of exact timing** (scheduler ticks every `autorun_check_interval`=10s by default). Client countdown "T-minus" may drift by up to one tick; do **not** show a second-precision countdown that implies server sync.
- Emitted events after spawn: `autorun.updated` (status active) + `session.created` (new session, `autorun_id` set) — client can **auto-navigate** to the spawned session's live view from these.

**Affordance summary (autoruns):** ⏳ create spinner; 🔄 countdown (tick-granular) + status flips; 🛑 delete-confirm w/ live-run warning; ✅ "run started" toast from `session.created`; 🧹 invalidate autorun + session lists on any update.

---

### 13.4 Recording / Remux progress wire contract

Remuxing is the most UI-relevant async server flow — it emits **progress events** the client can render as a progress bar:

| Event | Payload | When |
|---|---|---|
| `session.updated` | `status=remuxing` (full entity) | After engine `done` while `recording:true`; server moves session to remux |
| `session.{id}.remux.progress` | `{session_id, percent, eta_seconds?, speed?, time?, frame?}` (parsed from ffmpeg `-stats`, ~every 5s) | During remux; only while a RecordingManager is active |
| `session.updated` | `status=finalizing` (full entity) | After remux completes, before DB/row finalize |
| `recording.created` | full `RecordingResponse` (enriched: `disk_path`, `content_url`, `duration_seconds`, `size_bytes`) | Once the `.mp4` exists in `recordings_dir` |
| `session.updated` | `status=completed`, `ended_at` set | Final |
| `recording.deleted` | `id` only, no data | On `DELETE /recordings/{id}` |

**Client MUST:**
- Render a **progress bar** during `remuxing` using `percent` (fall back to indeterminate spinner if only `status=remuxing` and no progress events within ~10s — progress events can be missed if client reconnects late).
- **Never put a delete button on a `remuxing`/`finalizing` session** (server 409s; also data loss).
- After `recording.created`, offer "Open recording" (content_url) + show thumbnail preview if content_url reachable; if 403/404 (server not serving media), fall back to a copy-link + hint.

**Affordance summary (recordings):** 📶 progress bar during remux; 🔄 live size/duration as it finalizes; ✅ "Recording saved" toast; 🛑 delete confirm; 🧹 invalidate recording list on `recording.created`/`recording.deleted`.

---

### 13.5 Import/Export wire contract

| Step | Client sends | Server answers | When / why |
|---|---|---|---|
| Export profile | `GET /import-export/profiles/{id}/export` | 200 bundle JSON (`{version:1, exported_at, profiles:[...], autoruns:[]}`) **or** 403 (not owner) / 404 | User clicks Export |
| Export autorun | `GET /import-export/autoruns/{id}/export` | 200 bundle **with embedded profile + autorun** (`autorun.profile` inline) | Same |
| Validate | `POST /import-export/validate` (body = **raw bundle object**) | 200 `{valid:bool, profiles:[{name, content_hash, valid, issues:[{problem,...}]}], autoruns:[...]}` **or** 400 "Unsupported bundle version" (version≠1) | User drops/selects file; parse locally (client should reject non-JSON/non-version-1 early) |
| Apply | `POST /import-export/apply {bundle, plugin_map, removed_profiles?, removed_autoruns?}` | 200 `{profiles_created, profiles_skipped, autoruns_created}` | After user resolves all issues interactively |

**Validate — the interactive report (concrete):**
```json
{
  "valid": false,
  "profiles": [
    {"name":"p2","content_hash":"4494…","valid":true,
     "issues":[{"problem":"already_exists","existing_id":1}]},
    {"name":"p-missing-eng","content_hash":"abc…","valid":false,
     "issues":[{"problem":"not_installed","origin_hash":"…","name":"engine_x"},
                {"problem":"name_conflict","existing_id":2}]}
  ],
  "autoruns": [
    {"name":"t2","valid":false,
     "issues":[{"problem":"profile_missing","profile_name":"p-gone"},
                {"problem":"engine_override"}]}
  ]
}
```
- **`already_exists`** (content_hash identical) → UI marks "already imported — skip" (default) and offers "import as copy" (auto-rename server-side via `_unique_name`).
- **`not_installed`/`hash_mismatch`** → UI opens a **plugin-mapping picker**: dropdown of installed engines/resolvers whose `origin_hash` matches, else "choose manually". The picker feeds `plugin_map` (`{origin_hash: {type, id}}`).
- **`name_conflict`** → UI shows the auto-rename (`name_2`…`name_199`) as a preview + confirm.
- **`profile_missing`** (autorun references a profile not in bundle) → UI flags; user can tie to an existing profile or let it use inline config.
- After resolution → **Apply** → 🛑 on `400` with server-side revalidation failure; ✅ toast with `profiles_created/...` counts.

**Client MUST NOT send `removed_*` unless user explicitly excluded items** — default apply includes everything; per-item toggles map to those arrays.

**Affordance summary (import/export):** ⏳ validate spinner (one call); 🔄 live re-resolution as user picks mappings (local re-compute only — no extra server call); 📋 copy-able hashes; 🛑 per-item issue badges + toast on apply failure; ✅ success summary; 🧹 invalidate profiles+autoruns lists after apply.

---

### 13.6 Profiles, Engines, Resolvers wire contract

| Action | Client sends | Server answers / why |
|---|---|---|
| List profiles | `GET /profiles/` | Paginated; `requester_user_token` per row (owner label) |
| Create | `POST /profiles/` | 200 `ProfileResponse`; **400** duplicate name; **422** invalid engine/resolver or bad `resolver_config` vs `config_schema` |
| Update | `PUT /profiles/{id}` | 200; excludes unset — client should send whole form or patch? **`exclude_unset` = partial OK**; same validations |
| Delete | `DELETE /profiles/{id}` | **204**; **400/409 if FK-referenced by autoruns/sessions** — client must pre-empt with "in use by N autoruns" dialog (query lists, count refs) |
| Engines | `GET /engines/` | Paginated `EngineResponse[]{id,name,description,origin,origin_hash,capabilities:{can_record,can_playlist},retry_modes_schema}` — pure introspection; **no writes ever** |
| Resolvers | `GET /resolvers/` | Paginated `ResolverResponse[]{id,name,description,origin,origin_hash,config_schema}` — introspection only |

**Dynamic-form contract (the JS client MUST build forms from these schemas — this is the single most important UI-generic behavior):**
- `config_schema` (resolver) / `retry_modes_schema.<mode>.schema` (engine) are **JSON Schema objects**; `default_params` gives initial field values.
- Client renders: typed inputs (string/number/integer/boolean), `enum` → select, `minimum/maximum` → validation bounds, `default` → prefill, `required` → required marker. Nested objects → collapsible group. Unknown property key → free-form key/value editor (must still submit).
- On submit: build `{...default_params, ...userValues}` → server validates; 🛑 map 422 `loc` back to form fields for inline errors.

**Capability gates (server-enforced, client should reflect):** `engine.capabilities.can_record=false` → disable recording toggles for sessions/autoruns using that engine (tooltip). `can_playlist` → show "playlist" affordance if any.

**Affordance summary (profiles/plugins):** ⏳ form loading; 🔄 live capability badges; 🛑 inline 422 mapping; ✅ create/update; 🧹 invalidate engine/resolver list when returning to a form (they can change on plugin reinstall).

---

### 13.7 Users & API clients wire contract (admin)

| Action | Client sends | Server answers / why |
|---|---|---|
| List users | `GET /auth/users` | 200 `UserResponse[]` (id, username, role, display_name) — admin only, **403** if not admin |
| Delete user | `DELETE /auth/users/{username}` | 200 `{"status":"deleted"}` **or** **400 "cannot delete last admin"** |
| List clients | `GET /auth/clients` | 200 `ClientResponse[]` — NEVER includes plaintext key (only `id,name,is_active,created_at`) |
| Create client | `POST /auth/clients {name}` | 200 `{id, name, plaintext_key}` — **plaintext returned exactly once**; client must display immediately (copy button) + warn "shown once" |
| Delete client | `DELETE /auth/clients/{id}` | 200 `{"status":"deleted"}`; revokes key |

**Timing/UX:** keys are static credentials; no expiry. Client should:
- Show "create key" modal that **displays the generated key in a monospace copy-field with a one-time warning** (re-open won't show it).
- 🛑 "Cannot delete the last admin" guard inline (server enforces; client pre-empts by counting admins from the list).
- 🧹 refresh users/clients list after any mutation.

---

### 13.8 Notifications wire contract (bell feed)

| Action | Client sends | Server answers / why |
|---|---|---|
| List | `GET /notifications/` | 200 `NotificationResponse[]` (id, user_id, resource_type, resource_id, event_type, title, body, read, created_at) — own only; **401 if `auth.user is None`** (API-key clients get 401 — they have no user) |
| Get one | `GET /notifications/{id}` | 200 **or** 404 (not owner) |
| Mark read | `POST /notifications/{id}/read` | 200 updated row |
| Mark all | `POST /notifications/read-all` | 200 `{"status":"all_marked_read"}` |
| Delete | `DELETE /notifications/{id}` | 200 `{"status":"deleted"}` |

**Push contract:** `/ws/notifications` on connect → server **flushes all unread notifications** (each as a frame), then pushes new ones re-broadcast from NATS lifecycle events. Frames (synthetic when no DB row yet):
```json
{"type":"notification","data":{"resource_type":"session","resource_id":5,
 "event_type":"session.crashed","title":"session 5: session.crashed",
 "created_at":"2026-09-06T15:41:35Z","read":false}}
```
**When do notifications actually arrive?** Currently the server synthesizes them from lifecycle events (`session.started/stopped/crashed`, `recording.created`, etc.) through the relay — **not from `notifications` DB rows** (those exist for future). So the client bell should treat the WS notification feed as the primary live stream *and* reconcile the REST list as the history; mark-read only affects REST rows/simulated feed.

**Client MUST:**
- Decrement unread badge on `read`/`read-all`; increment on new push.
- Click → navigate to `resource_type`/:id (session/autorun/recording/profile).
- 🛑 Nothing to fail — feed is push-only; polling fallback = `GET /notifications/` on WS-down.

---

### 13.9 Cross-cutting wire facts (client MUST encode)

1. **Naive-UTC everywhere, all inputs/outputs**. `started_at`, `ended_at`, `start_time`, `end_time`, `created_at`, `exported_at`, `attempts[].started_at/ended_at` are all naive UTC (server strips tz on write; rejects tz-suffixed → 422). Client converts to local for display, back to UTC-naive for writes.
2. **Pagination cursor** — after any filter change, reset cursor; `has_more:false` = stop loading. `limit` max 200.
3. **409 semantics** — delete-while-remuxing (sessions), FK-referenced profile delete. All other conflicts are 400 (duplicate name).
4. **204 = empty body** — do not parse; do not show a toast body.
5. **422 detail array** — field errors with `loc`; map back to form fields (see 13.6). Some 422s are custom `{"detail":"Invalid data format...","errors":[...]}` — handle both.
6. **WS close codes** — 4001 = auth (logout); 1013 = temporarily unavailable (backoff+retry); anything else = reconnect with capped backoff, then polling fallback.
7. **Timing budget** — control requests 5s timeout; WS event→UI latency ~≤1s; autorun tick ≤10s; remux progress ~5s cadence. Build UX with these as "worst-case refresh expectations".

---

### 13.10 Implementer's-eye gaps, edge cases & code-verified facts

This subsection collects facts an implementer discovers only by reading the server source — things that are *true* but not obvious from the endpoint tables. Every claim was verified against `mirrorr-core` source (Sep 2026).

#### 13.10.1 API-key clients are "visible but not real" (critical gotcha)
- A request authenticated by `X-API-Key` resolves to `AuthState(client=<client>, user=None)`. It **can** create sessions/autoruns/profiles (`requester_user_token=""` — the server writes an empty token).
- But `subscribe_requester` **skips** when the token is empty → **no EventSubscription rows** → the key-created resource is **invisible in every user's WS event stream** and **never generates a notification** (notifications target users via subscriptions).
- Consequence for UI:
  - A resource created via API key shows `requester_user_token: ""` and **belongs to nobody** — no user list/table can filter to it, its events are dead air, and an admin viewing "all" sees it only by explicit `GET /sessions/` (no WS updates, no detail-enrichment on delete — enrichment is skipped for deleted subjects).
  - **Client MUST surface this**: when creating a resource while authenticated by key, show a hint "created as system/API-client resource — will appear to nobody, no notifications will fire unless a user adopts it." There is **no adopt/transfer endpoint** — document that limitation rather than pretend it exists.
  - Conversely, an admin UI **cannot** rely on WS to learn about key-created resources — must poll.

#### 13.10.2 Notifications: DB rows vs synthetic feed — two different shapes
- The `Notification` REST endpoints return **DB rows**: `{id, user_id, resource_type, resource_id, event_type, title, body, read, created_at}`.
- The WS `/ws/notifications` live feed sends **synthetic frames** built by `_NotificationsRelay` with `{resource_type, resource_id, event_type, title, created_at}` (from the NATS event) — **no `id`, no `body`, no `read`** unless the emitter embedded a full row in `data.notification`.
- **There is no 1:1 mapping.** A client that switches between REST list and WS feed must treat them as two sources: REST = history you can mark-read/delete; WS = live alert stream. Never join on `id` (WS ids don't exist for synthetic events). Mark-read/read-all/delete only make sense on REST rows.
- DB-row notifications are created only for lifecycle events of *subscribed users* (`session.started/stopped/crashed`, `recording.created`) — verified in `event_bus/handlers/handlers.py`.

#### 13.10.3 Notification REST is user-only
`GET /notifications/*`, mark-read, read-all, delete all 401 when `auth.user is None` — **API-key clients get 401 on the entire notifications surface** (they have no user). Client must not even attempt it with a key; show "notifications require a user session".

#### 13.10.4 Import/export limits and body sizes
- `MAX_BUNDLE_ITEMS = 500` profiles/autoruns each — `POST /import-export/apply` rejects larger bundles with 400. Client should count before apply and warn, not just surface the API error.
- `exported_at`, `attempts[].started_at`, notification `created_at`, etc. are all naive UTC — a spec-level consistency rule, but easy to trip on (they come back without `Z` suffix).

#### 13.10.5 Delete cascade semantics (server-side, not always obvious)
- `DELETE /autoruns/{id}` → deletes the autorun **and stops+deletes** any running session (emits `session.deleted` + `autorun.deleted`). The UI confirm must say "this will stop the live recording", and the client should listen for both WS events.
- `DELETE /sessions/{id}` on an active session → server sends `stop` control then deletes *after* cleanup — the WS event `session.deleted` arrives only after the supervisor actually exits (could be seconds). Client must not interpret the 204 as "immediately gone" — wait for the event or poll.
- `DELETE /profiles/{id}` with FK references → **400** (not 409). Client should pre-scan autoruns/sessions lists.

#### 13.10.6 `session_urls` empty-case is a first-class state
`build_session_urls` returns `[]` when `settings.web_url` is unset (the default) or when the session folder can't be made relative to content_dir. A "live" session in the default install has **no URLs, forever** — no M3U8, no player. Clients must treat empty `session_urls` as a normal state, not a bug: show "live URLs not configured (operator must set `web_url`)" and disable player affordances. Never hang a spinner on it.

#### 13.10.7 Rate limits (in-memory, per-IP) — design for 429s
- `login`: 10/min per IP; `register`: 5/min; `status`: 30/min. After restart they reset. Client must handle `429` with a retryable backoff toast (not a permanent error) and *not* hammer `GET /auth/status` on boot loops.

#### 13.10.8 No "run now" for autoruns — client composes it
There is no `POST /autoruns/{id}/run`. The UI "Run now" is sugar: `POST /sessions/` with the autorun's `engine_id/resolver_id/resolver_config/retry_*` (and `recording:true` if applicable). The spec forbids inventing a server endpoint; the client just wires two calls.

#### 13.10.9 WS events are enriched — but only for non-deleted subjects
`_EventsRelay` calls `_fetch_entity` only when subject ∉ {`*.deleted`}; deleted frames carry the raw emit payload (`id`, maybe `requester_user_token`), **no entity**. Also `_fetch_entity` can return `None` on a race (entity deleted between event and fetch) — the frame then keeps the bare emit payload and `data` may be missing. Clients must handle "no data on updated/started" gracefully (refetch via GET, don't crash).

#### 13.10.10 Cross-client coordination (multi-UI reality)
Any two clients (web + CLI script) share one server:
- Both see the same WS events (root subscription is global; per-resource relevance applies to each client's subscriptions).
- **Optimistic cache breaks cross-client**: if client A deletes a session, client B's cache is stale until B receives `session.deleted`. B must reconcile on WS events, never assume local mutating calls are the only source of truth.
- Timezones: autorun `start_time` naive-UTC means a client in UTC+2 and another in UTC-5 both render the same instant in their own local — the **server decides the instant; clients only render**. Never store tz in the client DB.

---

### 13.11 Implementer's-eye second pass — product-meaning gaps

Beyond wire facts, these are *semantic* truths an implementer needs to build the right UI. They answer "what does this actually mean for the user's mental model?"

#### 13.11.1 Autoruns are ONE-SHOT, not recurring (the biggest missed concept)
There is **no recurrence** (no cron/RRULE/weekday). A `Start/Stop → Autorun` maps to exactly **one** session:
- `Autorun.SCHEDULED` + `start_time <= now` → spawn **one session**, flip status → `active`.
- When the session ends, `Autorun` status mirrors it → `completed`/`failed`. It never resets to `scheduled`.
- `end_time` stops the *live session* via `stop` control (and graceful → `completed`), not "unschedule".
- A `start_time` in the past **still spawns** (backfill trigger).

**What the client MUST name it:** the UI concept is "Scheduled recording / one-off timer", **not** "Recurring schedule". Do **not** render weekday/cron pickers (there is nothing to feed them), do **not** promise "repeats weekly". If a user expects recurrence, the honest answer is "create a new autorun each time, or use a profile + external cron". Document this so the UX copy doesn't lie.

Corollary: autorun list states are `scheduled` (future, one run), `active/recording/...` (its run is live), `completed`/`failed` (spent — never re-arms). UI should visually separate "spent" autoruns (they will not run again) from `scheduled` ones, and default-filter to hide spent. **This is a client-side filter only — no server endpoint.**

#### 13.11.2 Editing an autorun is a real hazard (mutating an in-flight schedule)
`PUT /autoruns/{id}` updates ANY field (including `start_time`), even while the autorun is `active`/`recording` (its session is live). Concretely:
- Change `engine_id`/`resolver_id`/`config` while running: the **spawned session already captured the old config at spawn** — the edit changes the DB row but the live session keeps running with the old config. UI will show config that no longer matches the running process. **Client should lock (disable) config edits while status ∈ {`active`,`recording`,`terminating`,`remuxing`,`finalizing`}** and label "changes affect the next run, not the current one" (even though there is no next run for a completed autorun — reinforce 13.11.1).
- Change `end_time` to a past time while live: next scheduler tick sends `stop` to the running session. **Unintended stop!** Client should warn when editing `end_time` of a live autorun.

No server lock exists — the client owns this protection. (This is a *spec-level product safety rule*, not just UX.)

#### 13.11.3 Session owns the recording... but there's no source-session backlink
`RecordingResponse` snapshots `profile_name/engine_name/resolver_name` (denormalized) but has **no `session_id`**, so:
- Can't navigate "which session produced this recording" from the recordings list.
- An administrator correlating a failure ("recording exists but session says failed?") can't join them.
Client should **not** invent the link; if it's needed, it's a server addition (see 13.12.2). For now: recordings are a flat archive.

#### 13.11.4 Profile copy-on-create means live sessions detach from their profile
`POST /sessions/` accepts `profile_id` but the supervisor **captures the config at runtime** (from the session row, not the profile). So:
- Editing a profile after starting sessions does **not** affect in-flight sessions (good), but also: any "profile" a session references is non-binding once created.
- The "Save as profile" round-trip (`session.save-as-profile`) re-materializes whatever the session currently holds — useful, but the client must show that it snapshots *current* config, not retro-apply.

#### 13.11.5 No true "player" — treat content_urls as progressive/link-only
`content_url` is built as `{web_url}/content/...` and served only when the operator enables `dev_serve_files` (or proxies). It is a **static file path**, not a media API — no range/seek guarantees, no auth in the path (relies on the middleware's auth when dev-serving). Clients must treat recordings as **download/open-in-new-tab links**, not embed a guaranteed `<video>` with scrubbing. If seeking matters, flag it as a server gap, don't paper over with client hacks.

#### 13.11.6 There is no "share" and no "transfer" — import/export IS sharing
Profiles/sessions/autoruns are owner-scoped (`requester_user_token`). The only cross-user/cross-install path is **export bundle → import**. Clients should present Export as "Share / backup / migrate" — the spec's sole portability primitive. (No per-resource "make public" flag exists.)

---

### 13.12 "Free-gain" response enrichment — what to return so the client saves requests

This is the **roadmap of server-side additions** (planned code edits) surfaced by asking *"if I were building this UI screen and got this response, wouldn't I want X?"*. Each item names: the gap, the concrete UI it unblocks, and the cost class. **Priority = request-savings per unit of server work.**

> ⚠️ These are **proposals for the core team / future client contract**, not current guarantees. Until the server implements them, the client MUST NOT rely on them and MUST fall back to the request-extra strategy (or a extra field's absence).

#### 13.12.1 [HIGH] Return `_name` snapshots on Session/Autorun (kills 2 extra calls per list)
**Gap:** `SessionResponse` has `engine_id`/`resolver_id`/`profile_id` (IDs only). `RecordingResponse` already snapshots `profile_name/engine_name/resolver_name`, proving the pattern. The sessions/autoruns lists have to resolve IDs → names via `GET /engines/{id}`, `/resolvers/{id}`, `/profiles/{id}` for **every row** (or cache-map locally, which drifts after plugin rehash).

**Wouldn't I want:** `engine_name`, `resolver_name`, `profile_name` (nullable) inlined. Then a session card shows "▶ Live · yt_dlp_piped → static · p2" with **zero extra requests**, and it can't go stale/cross-thread.

**Cost:** 1–3 `selectinload` per list query (server already uses selectinload in the scheduler) + 3 schema fields. **Free gain** — the server has the join in memory at load time; N+1 is 100% avoidable with `selectinload`.

**Concrete UI saving:** sessions list of 50 rows → **150 saved requests** (3 names × 50), and the list renders in one pass (no skeleton-per-resolver-name).

#### 13.12.2 [HIGH] `content_url` needs an `is_served` flag + `session_id` backlink on Recording
**Gap A:** `content_url` is non-empty even when the operator hasn't enabled media serving (`dev_serve_files`/proxy) — so the play/link button is a dead link by default. Client can't know without probing.

**Wouldn't I want:** `RecordingResponse.media_served: bool` (computed server-side from `settings.dev_serve_files`/`web_url` presence). UI renders a real "Play/Download" button only when `true`, else a "media not served on this install" hint — no client `<video>` probe, no HEAD request per row.

**Gap B (from 13.11.3):** no source-session link.

**Wouldn't I want:** `session_id: int | null` (snapshot the session that created it at `_create_recording_entry`). Enables "open originating session" nav + admin correlation. **Free** — the session is in scope when the row is written; store the FK at creation.

**Cost:** store one column + one serialized field; no query change.

#### 13.12.3 [MEDIUM] `/auth/status` should return "system ready" (health + bootstrap in one call)
**Gap:** on app boot the client does a sequence: `/auth/status` (has_users), `/auth/me` (session), `/health` (API up), and may also want a "server configuring / NATS not ready" state for first-run UX.

**Wouldn't I want:** `GET /auth/status` → `{"has_users": bool, "version": "...", "ready": bool}` where `ready` = NATS connected + DB initialized (cheap `bus.nc.is_connected` + a constant). Boot becomes **one** call instead of three, and the client can show "backend initializing…" instead of a misleading login form during a slow first NATS boot.

**Cost:** read two booleans already in memory. **Free.**

#### 13.12.4 [MEDIUM] Include `retryable_exit_codes` in `retry_modes_schema` for `exit_code` mode
**Gap:** the schema already describes *how to configure* retry, but not *what will happen*. A user picking `exit_code` can't see which codes retry.

**Wouldn't I want:** `retry_modes_schema.exit_code` to carry `retryable_codes: [1]` (from `get_retryable_exit_codes`) so the form can render "retries on crash with exit code ∈ {1}".

**Cost:** it's computed by a pure function already in code; serialize it once. **Free.**

#### 13.12.5 [LOW] Pagination envelope could carry `total`
**Gap:** `{items,next_cursor,has_more}` gives "has more" but not "how many".

**Wouldn't I want:** `total` (or `total_estimate` for large tables) so the client can show "143 recordings" and compute scrollbar/percent. Response already does `limit+1` lookahead, so a cheap `count(*)` (or the lookahead's real count) is one extra aggregate.

**Cost:** one `COUNT(*)` per list — acceptable; **not free** for huge tables, so `total_estimate`/optional param (`?include_total=1`) is the prudent variant.

#### 13.12.6 [LOW] `GET /import-export/apply` should return the created objects' names/ids
**Gap:** apply returns counts only. After a 20-item import the client must re-list to learn the new names (and to know which got renamed).

**Wouldn't I want:** `{profiles_created, profiles_skipped, autoruns_created, created: {profiles:[{id,name}], autoruns:[{id,name}]}, renamed: {[old]:new}}` so the wizard shows a precise "Imported p2 → p2_2" summary and navigates straight to the new items.

**Cost:** the apply loop already has each created object in hand; collect ids/names into the response. **Free.**

#### 13.12.7 [LOW] User/Client "last active" is client-side only
**Wouldn't I want:** nothing server-side — no audit log currently exists, so "last login" can't come from the API. Client must **not** fake it. (Noted as a non-feature so no client invents an "activity" column.)

---

### 13.13 Consolidated "request-savings" cheat-sheet for the client (no server change needed)

Where the client can *already* save requests with the present API:

| Want | Do (client-only) | Saves |
|---|---|---|
| Names for a session/autorun list | Local memoized map: on first `GET /engines/` + `/resolvers/` + `/profiles/`, build `id→name`; invalidate on WS `*.updated/deleted` | N×3 → 3 total |
| "Has media?" without per-row probe | `content_url` empty ⇒ no media; non-empty ⇒ *probably* served (probe once, cache boolean) | N probes → 1 |
| Untitled / "shown so far" counts | Derive "50+ shown" honestly: page until `has_more:false` only if the user asks for a total; otherwise render "50+" per page | N extra pages |
| Realtime reconcile | Never refetch the list you just got an optimistic update for; rely on WS coalesced patch; refetch only on `data==null` frames | half the refetches |

---

## 14. Verification checklist (client conformance)

- [ ] Login/refresh/logout/change-password flows per 2.1 (incl. credentials-version forced logout).
- [ ] All REST endpoints called with exact paths/trailing-slash rules (1.1). 38 OpenAPI paths incl. `GET /health`, `GET /favicon.ico`.
- [ ] Pagination cursor handling on every list.
- [ ] Dynamic engine/resolver/retry forms generated from `retry_modes_schema` + `config_schema` (8.1).
- [ ] Status map render for all 7 session + 8 autorun statuses (12.2).
- [ ] UTC naive-UTC time discipline (5, 12.3).
- [ ] Role gating: admin-only surfaces (users/clients) hidden for non-admin (server enforces 403 — client UX hides).
- [ ] Control async semantics: optimistic UI reconciled with authoritative WS event (7).
- [ ] Import wizard: validate → resolve plugin_map → confirm renames → apply (9.1).
- [ ] WS reconnect/backoff/close-code handling + polling fallback (11.1).
- [ ] Notifications: bell badge, mark read/read-all/delete, click-to-navigate (11.2).
- [ ] Delete confirmations on: session, autorun (warns live-run stop), recording, profile, user (last-admin guard), client key.
- [ ] API key one-time display with copy + warning (2.1.8).
- [ ] 204 empty-body, 422 field mapping, 400/409/429/5xx toasts (13.9.4–13.9.7).
- [ ] Autoruns framed ONE-SHOT (no recurrence UI/weekday pickers; separate "spent" vs "scheduled") (13.11.1).
- [ ] Config + end_time edits locked while an autorun is live, with "may stop the running session" warning (13.11.2).
- [ ] `content_url` treated as progressive/link-only (no guaranteed `<video>` scrubbing) (13.11.5, 13.12.2).
- [ ] Request-savings: id→name memo map, single gateway probe, reconcile-via-WS-no-refetch (13.13).

---

## Appendix A — Complete endpoint map (OpenAPI-verified, Sep 2026)

Legend: `M` = required auth, `A` = admin, `O` = owner-scoped, `P` = public.

| Method & path | Auth | Purpose |
|---|---|---|
| GET /health | P | liveness |
| POST /auth/register | P/A | first-user admin, else admin |
| POST /auth/login | P | JWT cookies |
| POST /auth/logout | M | revoke+clear |
| POST /auth/refresh | M | rotate |
| GET /auth/me | M | whoami |
| GET /auth/status | P | has_users |
| POST /auth/change-password | M | bump cv |
| GET /auth/users | A | list users |
| DELETE /auth/users/{username} | A | delete (last-admin guard) |
| GET /auth/clients | A | list keys |
| POST /auth/clients | A | create (one-time key) |
| DELETE /auth/clients/{id} | A | revoke |
| GET/POST /profiles/ | M | list/create |
| GET/PUT/DELETE /profiles/{id} | M/O | read/update/delete |
| GET/POST /sessions/ | M | list/create (starts immediately) |
| GET/DELETE /sessions/{id} | M/O | read/delete (409 remuxing) |
| POST /sessions/{id}/stop | O | stop control |
| POST /sessions/{sid}/recording/enable|disable | O | mid-run toggle |
| POST /sessions/{sid}/save-as-profile | O | snapshot |
| GET/POST /autoruns/ | M | list/create |
| GET/PUT/DELETE /autoruns/{id} | M/O | read/update/delete |
| POST /autoruns/{id}/save-as-profile | O | snapshot |
| GET /recordings/ | M | list |
| GET/DELETE /recordings/{id} | M/O | read/delete |
| GET /engines/, /engines/{id} | M | plugin intel (incl. retry schemas) |
| GET /resolvers/, /resolvers/{id} | M | plugin intel (incl. config schema) |
| GET /import-export/profiles/{id}/export | O | bundle download |
| GET /import-export/autoruns/{id}/export | O | bundle download |
| POST /import-export/validate | M | dry-run report |
| POST /import-export/apply | M | commit bundle |
| WS /ws/events | M | live entity stream |
| WS /ws/notifications | M | bell feed |

(*Appendix B — WebSocket frame examples, illustrative only* — see 11.)