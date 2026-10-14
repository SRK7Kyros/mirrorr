# `@/api` — the Mirrorr web API layer

A standalone TypeScript module that owns **everything between the Mirrorr core
REST/WebSocket server and the UI**. It has no React components, no routing and
no styling. Any client (web console, Capacitor app, embedded widget) can be
built on top of it.

```
┌──────────────────────────────────────────────────────────────────┐
│ UI (React, routes, styles)          ← the only consumer           │
├──────────────────────────────────────────────────────────────────┤
│ hooks/        TanStack Query + external-store subscriptions       │
│ endpoints/    typed REST wrappers (one function per route)        │
│ schemas/      Zod contracts for every response                    │
│ realtime/     WebSocket manager + event table (cache writes)      │
│ domain/       pure logic (status, time, errors, bundles, filters) │
│ entity-store/ arrival-order-independent cache merge rules         │
│ client.ts     fetch + ApiError + single-flight refresh            │
│ config.ts     the single VITE_API_URL read site                   │
└──────────────────────────────────────────────────────────────────┘
                              │ HTTP + WS
                              ▼
                   mirrorr-core  (FastAPI, :8000)
```

## Directory map

| Path                       | Responsibility                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `client.ts`                | `apiFetch`, `ApiError`, single-flight token refresh, 422 → field errors, proactive refresh.          |
| `config.ts`                | `getApiUrl()` — the only place `VITE_API_URL` is read.                                               |
| `auth.ts`                  | Session store + `login`/`register`/`logout`/`changePassword`, API-client principal, navigation seam. |
| `schemas/`                 | Zod schemas + inferred types for every entity and envelope.                                          |
| `endpoints/index.ts`       | Typed REST wrappers: sessions, autoruns, recordings, profiles, plugins, import/export.               |
| `endpoints/settings.ts`    | Users, registration approval, API clients.                                                           |
| `query-keys.ts`            | Query-key factories, stale-time table, cursor pagination + sort/merge helpers.                       |
| `query-client.ts`          | The single `QueryClient` (retry 1, 30 s staleTime, no focus refetch).                                |
| `polling.ts`               | Refetch intervals derived from auth principal + socket health.                                       |
| `hooks/`                   | `useEntityList`, lookups, auth/realtime/notification hooks.                                          |
| `realtime/manager.ts`      | Two WebSockets (`events`, `notifications`) with backoff, close-code handling and a polling fallback. |
| `realtime/event-table.ts`  | Frame → cache-write routing; coalesced invalidation; remux-progress subscription.                    |
| `entity-store.ts`          | Five pure merge rules so WS/mutation/refetch writes are arrival-order independent.                   |
| `status.ts`                | `STATUS_MAP` — the single source of truth for status → label / tone / dot / actions.                 |
| `time.ts`                  | Naive-UTC discipline + display formatters.                                                           |
| `domain/errors.ts`         | `getErrorMessage` — one shared `ApiError`-aware message extractor.                                   |
| `domain/dirty.ts`          | Form dirty-tracking (diff/snapshot field maps).                                                      |
| `domain/bundle.ts`         | Import/export bundle inspection + apply-body construction.                                           |
| `domain/filter-grammar.ts` | `scheduled / live / spent / all` filter tokens + status matchers.                                    |
| `index.ts`                 | Barrel re-exporting the whole surface (schemas & query-keys namespaced).                             |

---

## The HTTP client (`client.ts`)

`apiFetch<T>(path, init)` is the only way the layer talks to the server.

- Base URL comes from `getApiUrl()` (`/api` by default → the Vite dev proxy
  forwards it to `:8000`; set `VITE_API_URL` for a cross-origin API). The server
  runs `redirect_slashes=False`, so **list paths keep their trailing slash** and
  item paths do not.
- Always sends `credentials: "include"` — the session rides an HttpOnly cookie.
- **Single-flight refresh**: concurrent `401`s share one `POST /auth/refresh`,
  so refresh-token rotation (JTI) can never race. A refresh that itself 401s
  latches the auth-exhausted seam once → one logout, never a retry storm.
- Network failures become `ApiError(0, …)` so callers can distinguish "recorder
  unreachable" from a real HTTP error.
- FastAPI `422` `detail: [{loc, msg}]` is flattened to
  `ApiError.fieldErrors = { field: message }` for form binding.
- `startProactiveRefresh()` arms a 23 h timer plus a `visibilitychange` refresh
  (when the last refresh is > 1 h old); `stopProactiveRefresh()` clears both.

```ts
import { apiFetch, ApiError } from "@/api/client";

try {
  const raw = await apiFetch<unknown>("/sessions/1");
} catch (error) {
  if (error instanceof ApiError && error.status === 404) {
    /* … */
  }
}
```

`setAuthExhaustedHandler(fn)` / `resetAuthExhausted()` / `lastAuthRefreshAt()`
are the seams `auth.ts` and the UI use to react to session expiry.

## Auth (`auth.ts`)

A tiny external store (`getAuthState`, `subscribeAuth`) drives both the route
guard and the chrome.

```ts
import { login, logout, ensureAuthMe, isApiClientPrincipal } from "@/api/auth";
```

- `ensureAuthMe()` — boot/guard flow: resolves on a session, `401` → anonymous
  and throws so the router redirects to `/login`.
- `login` / `register` / `logout` / `changePassword` — the session endpoints.
  `register` may return `RegistrationPending` when approval is gated.
- **API-client principal** (`client` set, `user` null): `isApiClientPrincipal()`
  is true, `apiClientBannerText()` renders the banner, and `polling.ts` forces
  the 10 s cadence because such resources emit no WS events.
- **Navigation seam**: the layer never imports the router. The UI calls
  `setAuthNavigator({ toLogin })` once; `forceLogout()` uses it (falling back to
  `window.location.assign("/login")`).
- `sanitizeRedirectPath(value)` accepts only same-origin absolute paths.

### Admin surface

No module here decides whether a caller is an admin. `GET /auth/admin-surface`
answers `204`/`403` for nginx, which then serves either `run/admin` (the build
whose entry is `admin.html`) or `run/web`. The standard build contains no admin
component, string or role check; the API independently withholds admin-only
response fields (see `mirrorr-core/src/mirrorr/api/privileged.py`) and omits
them from the OpenAPI document it serves to a non-admin. Admin UI reaches the
app through the generic settings-section slot (`ui/views/settings/sections.tsx`):
`admin.tsx` is the only module that fills it, so adding admin UI means adding a
section there, never an `isAdmin()` branch in shared code.

## Schemas (`schemas/`)

Every server response is validated on first parse. Entity shapes:

| Schema                            | Key fields                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionSchema`                   | `id`, `status`, `engine_id`, `resolver_id`, `profile_id?`, `recording?`, `started_at?`, `ended_at?`, `session_urls?`, `recording_progress?`, denormalized `*_name?`. |
| `AutorunSchema`                   | `id`, `user_friendly_name`, `snake_case_name`, `status`, `start_time`, `end_time`, `next_run_at?`, `last_run_at?`, denormalized `*_name?`.                           |
| `RecordingSchema`                 | `id`, names, `content_url`, `duration_seconds`, `size_bytes`, `created_at`.                                                                                          |
| `ProfileSchema`                   | `id`, `name`, `default_engine_id`, `resolver_id`, `resolver_config?`, `retry_mode?`.                                                                                 |
| `EngineSchema` / `ResolverSchema` | `id`, `name`, `origin`, `origin_hash`, `capabilities?` / `config_schema?`.                                                                                           |
| `UserSchema`                      | `id`, `username`, `role`, `display_name`.                                                                                                                            |
| `AuthResponseSchema`              | `user?`, `client?`, `access_token?`, `refresh_token?`.                                                                                                               |
| `NotificationSchema`              | `id`, `resource_type`, `resource_id`, `event_type`, `title`, `body?`, `read?`, `created_at`.                                                                         |
| `cursorPageSchema(item)`          | `{ items, next_cursor?, has_more, total? }`.                                                                                                                         |

All entity schemas are `.passthrough()` so unknown server fields survive; the
non-guaranteed fields are `.optional()` and callers must treat them as possibly
absent. Datetimes are **naive UTC strings** (no `Z`) — never parse them as local.

## Endpoints (`endpoints/`)

One function per route. Lists take `(cursor, limit = 50)` and return a
`CursorPage<T>`.

### Sessions

| Function                          | Route                                             |
| --------------------------------- | ------------------------------------------------- |
| `fetchSessionPage(cursor, limit)` | `GET /sessions/`                                  |
| `fetchSession(id)`                | `GET /sessions/{id}`                              |
| `createSession(body)`             | `POST /sessions/`                                 |
| `stopSession(id)`                 | `POST /sessions/{id}/stop`                        |
| `setSessionRecording(id, enable)` | `POST /sessions/{id}/recording/{enable\|disable}` |
| `deleteSession(id)`               | `DELETE /sessions/{id}`                           |
| `saveSessionAsProfile(id, name)`  | `POST /sessions/{id}/save-as-profile`             |

### Autoruns

`fetchAutorunPage`, `fetchAutorun(id)`, `createAutorun(body)`,
`updateAutorun(id, body)`, `deleteAutorun(id)`, `saveAutorunAsProfile(id, name)`
— `GET/POST /autoruns/`, `GET/PUT/DELETE /autoruns/{id}`,
`POST /autoruns/{id}/save-as-profile`.

### Recordings & profiles

`fetchRecordingPage`, `deleteRecording(id)`; `fetchProfilePage`,
`fetchProfile(id)`, `createProfile`, `updateProfile`, `deleteProfile`.

### Plugins & import/export

`fetchEnginePage` / `fetchResolverPage` (+ `fetchAllEngines` /
`fetchAllResolvers` crawl helpers), `fetchProfileExport(id)`,
`fetchAutorunExport(id)`, `validateBundle(bundle)`, `applyImport(body)`,
`normalizeValidateReport(raw)`, `downloadJson(filename, data)`,
`probeMediaUrl(url)`.

### Settings (`endpoints/settings.ts`)

`fetchUsers`, `deleteUser(username)`, `fetchRegistrationRequests`,
`approveRegistrationRequest(id)`, `denyRegistrationRequest(id, reason)`,
`createUser(username, password, displayName)` (register-pending → approve, which
avoids the cookie-hijack of a direct admin register), `fetchClients`,
`createClient(name)` → `{ client, apiKey }`, `deleteClient(id)`.

## Query keys & caching (`query-keys.ts`)

```ts
queryKeys.sessions(params); // ["sessions", params]
queryKeys.session(id); // ["session", id]
queryKeys.autoruns(params) / autorun(id);
queryKeys.recordings(params) / profiles(params) / profile(id);
queryKeys.engines / resolvers / notifications / users / clients;
queryRoots.sessions; // ["sessions"] — for list-wide invalidation
```

`staleTimes` centralises per-resource staleness (lists `0`, lookups `300 s`,
users/clients `30 s`). Helpers: `getNextPageParam`, `mergedSortedByIdDesc`,
`resolveEntityName`, `fetchAllLookupPages`, `PAGE_SIZE` (50),
`LOOKUP_PAGE_SIZE` (200).

## Hooks (`hooks/`)

```ts
const sessions = useEntityList<Session>({
  queryKey: queryKeys.sessions(),
  fetchPage: (cursor) => fetchSessionPage(cursor),
});
sessions.items;
sessions.isLoading;
sessions.hasMore;
sessions.loadMore();
sessions.loadAll();
sessions.refetch();
```

- `useEntityList` — cursor-paginated list with the polling cadence from
  `usePollingContext()` and the WS-poll-success resume contract.
- `useEngines` / `useResolvers` / `useProfiles` / `useNameMaps` — lookup tables
  and id→name maps for rows.
- `useAuthState` / `useAuthStatus` / `useRealtimeState` — external-store
  subscriptions.
- `useNotifications` + `useMarkNotificationRead` / `useMarkAllNotificationsRead`
  / `useDeleteNotification`.

## Realtime (`realtime/`)

`manager.ts` opens `/ws/events` and (for user principals) `/ws/notifications`,
with a `1s → 2s → 4s → 8s → 16s → 30s` backoff ladder, `MAX_ATTEMPTS = 12`,
close-code handling (4001 → refresh, then forced logout) and a polling fallback.
`useRealtimeState()` exposes `{ events, notifications, attempts,
pollingFallback }` for the connection indicator.

`event-table.ts` routes frames into the query cache: authoritative entity
frames write field-by-field, `deleted` frames remove, no-data frames trigger a
coalesced invalidation, and `session.{id}.remux.progress` streams to
`subscribeRemuxProgress(sessionId, listener)`. `installEventTable()` /
`disposeEventTable()` are called by `auth.ts` on session start/clear.

## Entity merge rules (`entity-store.ts`)

Pure list reductions, arrival-order independent:

1. mutation response inserts only missing ids;
2. authoritative snapshots replace field-by-field (later wins) and clear
   pending actions;
3. no-data frames never write fields;
4. optimistic `pendingActions` live outside the cache;
5. `deleted` wins — removes the id and cancels its pending actions.

## Domain modules

- **`status.ts`** — `STATUS_MAP` maps every server status to `{ label, tone,
dot, icon?, sessionActions, autorunActions }`. `getStatusDescriptor(status)`
  logs a warning and returns `unknown` for unrecognised strings. Tones are
  token _names_ (`primary | secondary | success | warning | danger | neutral`),
  never hex — the stylesheet owns colour.
- **`time.ts`** — `parseNaiveUtc` / `toNaiveUtc` (always append/strip `Z`),
  `formatDateTime` (the year is dropped unless it is not the current one),
  `formatDateTimePair` (start + end for stacked lines, the day printed once),
  `formatWindow` (date line above time line), `elapsedSeconds`,
  `formatRelativeTime`, `formatCountdown`, `formatBytes`, `formatDuration`,
  and `datetimeLocalToNaiveUtc` / `naiveUtcToDatetimeLocal` for
  `<input type="datetime-local">`.
- **`domain/errors.ts`** — `getErrorMessage(error, fallback)`.
- **`domain/dirty.ts`** — `diffDirtyFields`, `isDirty`.
- **`domain/bundle.ts`** — bundle validation helpers, `itemBadge`, issue
  classification, `buildApplyBody`.
- **`domain/filter-grammar.ts`** — `FILTER_TOKENS`, `parseFilter`,
  `matchesFilter`, `isLive`, `isSpent`, `shouldAutoExhaust`.

## Conventions (do not break these)

1. **Naive UTC everywhere.** Server datetimes have no `Z`; always go through
   `time.ts`.
2. **Trailing slash on collections.** `GET /sessions/` but `GET /sessions/1`.
3. **Validate on parse.** Endpoint wrappers Zod-parse; a mismatch warns and
   throws `ApiError(0, "Unexpected server response")` (retry once, then the view
   shows its error state).
4. **One root namespace per resource.** Invalidate via `queryRoots.*`, never
   ad-hoc keys.
5. **204 ≠ gone.** A delete returns 204 before the resource is actually gone;
   wait for the `deleted` frame or the poll.
6. **Colour is a token.** `status.ts` returns tone names; the stylesheet maps
   them to hex.
7. **The layer owns no router.** Navigation goes through `setAuthNavigator`.

## Adding an endpoint

1. Add/adjust the Zod schema in `schemas/`.
2. Add the wrapper in `endpoints/` (trailing slash for lists; `parseOrWarn`).
3. Add the query key in `query-keys.ts` if it is a new resource.
4. Wrap it in a hook in `hooks/` if the UI needs it reactive.
5. Document it in the tables above.
