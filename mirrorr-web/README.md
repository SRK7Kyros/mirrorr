# mirrorr-web

Operator console for mirrorr-core: sessions, autoruns, recordings, profiles, plugins. React 19 + Vite + TypeScript (strict) + TanStack Router (code-based route tree) + TanStack Query + Tailwind CSS v4 + Zod.

The previous implementation is preserved untouched at `../mirrorr-web-legacy/` for reference only — nothing in this app is copied from it.

## Quickstart

```bash
bun install
bun run dev        # http://127.0.0.1:5175
bun run typecheck  # tsc -p tsconfig.app.json --noEmit
bun run build      # dist/index.html + dist/mobile.html
bun run preview    # smoke-test the production bundle
```

Design source of truth: `../docs/web-frontend-spec.md` (contract behavior: `../docs/general-client-specification.md`).

## Build & deploy

```bash
bun run build      # → dist/index.html + dist/mobile.html + dist/assets/… (base "/")
bun run deploy:web # build with base "/", then publish dist/ into the nginx root ../dev/web
```

`deploy:web` runs `scripts/deploy-web.mjs`. It forces `MIRRORR_BASE=/` for the production build, so the deployed `index.html` references root-absolute `/assets/…` (never `/dev/assets/…`), then updates `dev/web` in place: it copies the new bundle over the existing tree first (the directory and its `index.html` are never absent, so the running server does not 404 mid-deploy), prunes stale hashed chunks, and preserves the `dev/web` inode — no systemd unit or nginx reload is needed. It exits non-zero without touching `dev/web` if the build fails or `dist/index.html` is missing or not root-based. The Vite dev unit on 5174 sets `MIRRORR_BASE=/dev/` itself and is unaffected.

Rollback: the pre-deploy build is snapshotted at `dev/web-legacy-backup/` (gitignored, like `dev/web`). To restore it:

```bash
cp -a ../dev/web-legacy-backup/. ../dev/web/
```

## Layout

| Path | Purpose |
|---|---|
| `index.html` | Desktop operator console entry |
| `mobile.html` | Mobile entry (Capacitor packaging in a later step) |
| `src/router.tsx` | Code-based TanStack Router tree |
| `src/routes/` | Route definitions |
| `src/styles.css` | Tailwind v4 CSS-first entry (`@import "tailwindcss"` + `@theme`) |
