# mirrorr

Self-hosted live-stream recorder and scheduler. Monorepo: Python FastAPI backend + React dashboard that share one API contract.

| Dir | What | Stack |
|---|---|---|
| `mirrorr-core/` | Event-driven stream ingest API (resolve → ingest → HLS → optional MP4) | Python 3.14, FastAPI, SQLModel/SQLite, NATS JetStream |
| `mirrorr-web/` | Operator dashboard (sessions, autoruns, recordings, profiles, plugins) | React 19, TanStack Router/Query, Tailwind v4, Zod |
| `docs/` | Shared contracts (client spec is authoritative for API behavior) | Markdown |
| `mirrorr-plugins/` | Private plugin repo (engines, resolvers, companion modules) — path set by `MIRRORR_PLUGINS_DIR` | Python |
| `deploy/` | Host-agnostic deploy: systemd unit + nginx conf **templates** (rendered by `deploy.sh` from a gitignored `deploy/mirrorr.local.env`), core run helper | Shell/systemd |

Component quickstarts live in `mirrorr-core/README.md` and `mirrorr-web/README.md`.
Contract source: `docs/general-client-specification.md`.
