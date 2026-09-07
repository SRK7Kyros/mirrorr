# mirrorr-core

Self-contained, event-driven live stream management service. Resolves stream configs, ingests via pluggable engines (`yt-dlp` piped to `ffmpeg`), serves live HLS (`.m3u8` + `.ts`), optionally records to MP4. Controlled via REST API + WebSocket event mirror. Python 3.14, FastAPI, SQLModel/SQLite, embedded NATS JetStream.

## Quickstart

```bash
cd mirrorr-core
uv sync                    # install dependencies
uv run mirrorr --help      # CLI: -c/--config, --host, --port, --nats-port,
                           # --base-dir, --hls-window, --segment-duration,
                           # --web-url, --dev-serve-files, --dev-seed-admin
cp .env.example .env       # edit BASE_DIR, API_PORT, JWT_SECRET_KEY, ...
uv run mirrorr             # boot: DB → ffmpeg → plugins → NATS → API → scheduler
```

Dev helpers: `uv run mirrorr --base-dir ./dev-data --dev-serve-files --dev-seed-admin` (dev-only static mount + `admin/admin` seed), `uvx ty check src` (typecheck).

## Config essentials

`MirrorrSettings.create_from_env(".env")` reads `.env`/env vars, CLI flags override. All paths derive from `BASE_DIR` (default `.`).

| Var | Default | Purpose |
|---|---|---|
| `BASE_DIR` | `.` | Root for all state |
| `CONTENT_DIR` | `{BASE_DIR}/content` | Sessions + HLS segments |
| `RECORDINGS_DIR` | `{CONTENT_DIR}/recordings` | Finished MP4s |
| `ENGINES_DIR` / `RESOLVERS_DIR` | `{BASE_DIR}/plugins/...` | User plugin `.py` files |
| `DB_FILE` | `{BASE_DIR}/mirrorr_data.db` | SQLite (WAL) |
| `HLS_WINDOW` / `SEGMENT_DURATION` | `7200` / `10` | Manifest window / segment secs |
| `NATS_PORT` / `API_HOST` / `API_PORT` | `4222` / `localhost` / `8000` | Bind config |
| `WEB_URL` | `""` | Public base URL for session links |
| `JWT_SECRET_KEY` | `""` | HS256 secret (auto-generated if empty) |
| `DEV_SERVE_FILES` / `DEV_SEED_ADMIN` | `false` | Dev-only: mount `content_dir`, seed `admin/admin` |

Runtime state (`content/`, `plugins/`, `binaries/`, `nats-server/`, `*.db*`) is gitignored — never commit it.

## Plugin layout

Engines implement `EngineInterface`, resolvers implement `ResolverInterface` (ABCs in `src/mirrorr/plugins/interfaces.py`; retry schemas in `src/mirrorr/plugins/retry.py`).

```python
# my_engine.py → drop into ENGINES_DIR, synced to DB at boot (SHA-256 verified, JIT-loaded)
class MyEngine(EngineInterface):
    name = "my_engine"
    capabilities = Capabilities(can_record=True, can_playlist=True)
    async def start(self, context, source): ...  # return list[ManagedProcess]
```

Bundled defaults in `src/mirrorr/default_plugins/`: `engines/yt_dlp_piped.py` (yt-dlp → ffmpeg pipe → HLS), `resolvers/static.py` (fixed URL + headers passthrough). Example: point a profile at resolver `static` with config `{"url": "https://example.com/live.m3u8"}` and engine `yt_dlp_piped`.

## API surface

REST: `/sessions/`, `/autoruns/`, `/recordings/`, `/profiles/`, `/engines/`, `/resolvers/` (CRUD + session stop/recording toggles), `/auth/*` (register/login/refresh, users/clients), `/notifications/`, `/import-export/*`, `/logs/*`. Auth via `Authorization: Bearer <JWT>` or `X-API-Key`. WS: `/ws/events` (NATS mirror, enriched with entity `data`), `/ws/notifications` (unread backlog + live push).

Full reference: `ARCHITECTURE.md` (stack, boot 17 steps, session lifecycle, recording stash/remux, auth, WS, deploy nginx configs in `deploy/`).
