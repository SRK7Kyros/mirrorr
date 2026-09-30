# mirrorr-web

Operator console for mirrorr-core: sessions, autoruns, recordings, profiles, plugins. React 19 + Vite + TypeScript (strict) + TanStack Router (code-based route tree) + TanStack Query + Tailwind CSS v4 + Zod.

The previous implementation is preserved untouched at `../mirrorr-web-legacy/` for reference only — nothing in this app is copied from it.

## Quickstart

```bash
bun install
bun run dev        # dev server on http://127.0.0.1:5175 (the Playwright-managed port)
bun run build      # production bundle → dist/
bun run test:unit  # vitest: unit + component specs
bun run test:e2e   # playwright against the 5175 dev server
bun run typecheck  # tsc -p tsconfig.app.json --noEmit
bun run preview    # smoke-test the built bundle
```

Design source of truth: `../docs/web-frontend-spec.md` (contract behavior: `../docs/general-client-specification.md`).

## Config

`VITE_API_URL` is the **only** configuration value this app reads. `src/config/env.ts` is the single read site; the value is baked at build time and there is no runtime server picker.

| Variable | Development | Production | Purpose |
|---|---|---|---|
| `VITE_API_URL` | `/api` (from `.env.development`) | absolute origin, e.g. `https://mirrorr.example.org` | API base URL; WebSocket URLs derive from its origin |

Contract:

- **Required.** A missing, blank, malformed, or trailing-slash value throws at boot — naming `VITE_API_URL` — before any request is made, instead of failing later as an opaque fetch/WebSocket error.
- **No trailing slash.** Clients append exact paths and the server runs with `redirect_slashes=False`.
- **Root-relative or absolute.** `/api` keeps development same-origin: the Vite proxy forwards `/api/…` to `http://127.0.0.1:8000/` and `/ws/…` to the backend (see `vite.config.ts`). Production builds use an absolute `http(s)://` origin, optionally with a path.
- **WebSocket URLs are derived, never configured.** The base's origin (the page origin for `/api`) is re-schemed `http→ws` / `https→wss`, then suffixed with `/ws/events` or `/ws/notifications`. The base path is discarded, so `/api` yields `/ws/events` — never `/api/ws/events`.

`.env.example` documents the variable and its contract; copy it to `.env.local` for a machine-local override (gitignored).

## Build & deploy

```bash
bun run build      # → dist/index.html + dist/mobile.html + dist/assets/… (base "/")
bun run deploy:web # build with base "/", then publish dist/ into the nginx root ../dev/web
```

`deploy:web` runs `scripts/deploy-web.mjs`. It forces `MIRRORR_BASE=/` for the production build, so the deployed `index.html` references root-absolute `/assets/…` (never `/dev/assets/…`), then updates `dev/web` in place: it copies the new bundle over the existing tree first (the directory and its `index.html` are never absent, so the running server does not 404 mid-deploy), prunes stale hashed chunks, and preserves the `dev/web` inode — no systemd unit or nginx reload is needed. It exits non-zero without touching `dev/web` if the build fails or `dist/index.html` is missing or not root-based. The legacy local dev unit that serves the built bundle under a sub-path sets `MIRRORR_BASE` itself and is unaffected.

Both commands bake `VITE_API_URL` (see Config) into the bundle; a build made without it fails loudly at boot, naming the variable.

Rollback: the pre-deploy build is snapshotted at `dev/web-legacy-backup/` (gitignored, like `dev/web`). To restore it:

```bash
cp -a ../dev/web-legacy-backup/. ../dev/web/
```

## Layout

| Path | Purpose |
|---|---|
| `index.html` | Desktop operator console entry |
| `mobile.html` | Mobile entry (Capacitor packaging in a later step) |
| `src/config/env.ts` | The `VITE_API_URL` contract: validation, boot guard, WebSocket derivation |
| `src/router.tsx` | Code-based TanStack Router tree |
| `src/routes/` | Route definitions |
| `src/styles.css` | Tailwind v4 CSS-first entry (`@import "tailwindcss"` + `@theme`) |
