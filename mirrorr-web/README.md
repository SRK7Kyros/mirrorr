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

## Layout

| Path | Purpose |
|---|---|
| `index.html` | Desktop operator console entry |
| `mobile.html` | Mobile entry (Capacitor packaging in a later step) |
| `src/router.tsx` | Code-based TanStack Router tree |
| `src/routes/` | Route definitions |
| `src/styles.css` | Tailwind v4 CSS-first entry (`@import "tailwindcss"` + `@theme`) |
