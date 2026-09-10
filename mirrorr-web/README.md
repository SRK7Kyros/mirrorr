# mirrorr-web

React 19 dashboard for mirrorr-core: sessions, autoruns, recordings, profiles, plugins, per-session telemetry, account settings. TanStack Router (file-based) + Query, Zustand stores, Tailwind CSS + shadcn/ui, Zod-validated API client.

## Quickstart

```bash
cd mirrorr-web
bun install          # install dependencies
bun run dev          # dev server (port 5173)
bun run build        # production build → dist/
bun run typecheck    # tsc -p tsconfig.app.json --noEmit
bun run lint         # eslint .
```

## Config

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend base URL (REST + WS origin) |

Set in `.env.local` (gitignored): `VITE_API_URL=http://localhost:8000`. The API client (`src/lib/api.ts`) injects JWT/API-key auth, dedupes concurrent token refresh, retries once on 401, and logs to the floating network monitor.

## Real-time behavior

Two WebSocket hooks, both derived from `VITE_API_URL` (`getWsEventsUrl()` / `getWsNotificationsUrl()`):

- `/ws/events` (`use-ws-events.ts`) — NATS event mirror. Patches TanStack Query caches directly via `patchQueryCache()` (zero HTTP round-trip); falls back to `invalidateQueries` refetch when the event carries no `data` payload. Example: `session.updated` with entity data updates the sessions list in place.
- `/ws/notifications` (`use-ws-notifications.ts`) — auth-required push channel. Sends unread backlog on connect, then live toasts (deduped by notification ID).

Auth state (`auth-store.ts`, persisted to localStorage): JWT access + refresh tokens, current user, `isAuthenticated`. Routes under `_app/` redirect to login when unauthenticated; `_auth/` redirects away when already logged in.

Backend reference: `../mirrorr-core/ARCHITECTURE.md` (§4 frontend map, §6 API, §12 WebSocket).
