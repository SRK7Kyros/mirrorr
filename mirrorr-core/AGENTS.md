# Mirrorr Agent Context (`AGENTS.md`)

This file provides a highly optimized, high-precision context map of the **Mirrorr** codebase. It is designed to give LLM agents immediate, complete architectural understanding using minimal context window tokens.

---

## 0. Coding Style & Principles (READ FIRST)

**This is the most important section. All code written for Mirrorr MUST follow these principles.**

### Mandatory first step for new sessions
Before any coding, **read AGENTS.md in full** and confirm understanding. If it is stale or missing coverage for the task, report what is outdated or missing before proceeding. Do not assume — verify against the actual source files if anything is uncertain.

### Less is more
More code is often bad code. Elegant, compact code is preferred over verbose, ceremonial code. Every line must earn its place. If something can be inlined, inline it. If a class can be a function, make it a function. If a dataclass can be a plain dict, use a dict. Only introduce abstraction when it removes real complexity — not when it just makes things look more "designed".

### Reliability through condensation
The goal is to condense reliability into the least amount of classes and data structures possible. Each thing should have one concern and solve it well. The same semantical role split across many things is useless complexity. More complexity isn't bad, but less is more **when it doesn't remove value**.

### Batching concerns when it makes sense
If multiple things share the same lifecycle, the same connection, or the same output path — batch them together. Don't create separate classes, methods, or data structures for each if they can share infrastructure without losing clarity.

### Elegance over ceremony
Unnecessary docstrings, excessive error handling, and method-per-concern extraction are bad code. Code should be self-documenting through clear naming and minimal structure. Docstrings are good **only when they add information not obvious from the code itself**.

### Type safety, not type noise
Type hints are important. `TypeVar`, `ClassVar`, and other advanced typing constructs are used when they serve the code — not for decoration. If a type hint doesn't help the caller, don't add it.

### Compaction principle
> "more code is often bad code"

When refactoring, always check: does this change add lines that earn their place, or is it ceremony? Prefer removing lines over adding them. The best code change is one that reduces line count while preserving or improving behavior.

### No over-abstraction
Don't create context wrappers, shortcut methods, or intermediate dataclasses just because a "senior pattern" says so. If `context.bus.emit()` works, don't wrap it in `context.emit()`. If `bus` can be passed directly, don't wrap it in a context object.

### Line count reporting
After every editing session, report the number of lines added and removed across all changed files.

### Keep AGENTS.md up to date
After any meaningful edit to the codebase, update this file to reflect the changes. This includes:
- New or removed files in the directory structure
- New or changed features, models, events, or settings
- Updated status of implemented vs unimplemented features
- Any architectural changes that agents need to know about

AGENTS.md is the source of truth for agents working on this codebase. If it's stale, agents will make incorrect assumptions.

---

## 1. Project Essence & Direction
**Mirrorr** is a self-contained, event-driven live stream management service. It resolves stream configurations, downloads/records live streams using pluggable engines (`yt-dlp` piped to `ffmpeg`), generates live HLS playlists (`.m3u8` + `.ts` segments), and records high-frequency process telemetry.

**Long-term intent:** A self-hosted, API-driven live stream management backbone. Given stream sources (Twitch, YouTube, IPTV m3u, etc.), Mirrorr ingests them, transcodes/copies into HLS, optionally records to disk, and serves the segments over HTTP. Controlled entirely via REST API with WebSocket real-time event forwarding to a frontend.

**Current state:** The architecture and core pipeline (resolve → ingest → transcode → HLS) work. Autorun scheduling, recording lifecycle with stash/remux, and the autorun scheduler are implemented. CLI (`mirrorr` entry point, full argparse in `src/mirrorr/main.py`) and dev-only HTTP file serving (`--dev-serve-files` mounts `content_dir`) are implemented.

---

## 2. Core Architecture & Lifecycle

```mermaid
graph TD
    API[FastAPI Web Server] -- CRUD Operation --> DB[(SQLite DB)]
    API -- Emit Event --> NATS[NATS Server JetStream]
    NATS -- SessionCreated --> Handler[Event Handler]
    Handler -- Spawn Process --> Supervisor[Session Supervisor Process]
    Supervisor -- JIT Load --> Resolver[Resolver Plugin]
    Supervisor -- JIT Load --> Engine[Engine Plugin]
    Resolver -- Resolve Config --> Source[Source URL + Headers]
    Engine -- Run Subprocesses --> Proc1[yt-dlp] & Proc2[ffmpeg]
    Proc1 -- Pipe stdout/stdin --> Proc2
    Proc2 -- Write HLS --> Disk[HLS Segments & Playlist]
    Scheduler[Autorun Scheduler] -- Check schedules --> DB
    Scheduler -- Create/Stop Session --> NATS
    Supervisor -- Stash Segments --> Stash[stash/ folder]
    Supervisor -- Remux --> Recording[Recording DB Entry]
```

1. **Boot** (`MirrorrCore._boot()`): Creates directories, syncs the bundled default plugins, initializes SQLite DB, locates FFmpeg, syncs plugins to DB, starts local NATS server, connects NATS client bus, starts autorun scheduler.
2. **API & Events**: FastAPI CRUD endpoints write to `{base_dir}/mirrorr_data.db` and emit typed events (e.g., `SessionCreated`) over NATS.
3. **Process Isolation**: NATS handler intercepts `SessionCreated` and spawns an independent OS process (`multiprocessing.Process`) running `SessionSupervisor`.
4. **JIT Plugin Loading**: Supervisor dynamically loads Resolver and Engine plugins from the filesystem, verifying SHA-256 hashes against the database.
5. **Ingestion Pipeline**: Resolver resolves config → `Source` (URL + headers). Engine (e.g., `yt-dlp_piped`) runs `yt-dlp` piped to `ffmpeg`, writing HLS segments + `.m3u8` playlist to the session folder.
6. **Recording**: When recording is active, a background stash task copies the oldest 10% of segments to a `stash/` folder before ffmpeg deletes them. On session end, stash + remaining segments are concatenated via ffmpeg into an MP4, the session folder is moved to `recordings/`, and a `Recording` DB entry is created.
7. **Autorun Scheduler**: Polls every `autorun_check_interval` seconds. Creates sessions for autoruns whose `start_time` has arrived. Stops sessions linked to autoruns whose `end_time` has passed.
8. **Telemetry**: Supervisor captures subprocess stdout/stderr to log files and polls process resource usage (CPU, RAM, disk I/O) at 10Hz, forwarding to NATS for WebSocket clients.

---

## 3. Entry Points & Configuration

### CLI Usage
```bash
uv run mirrorr --help            # full argparse: -c/--config, --host, --port, --nats-port,
                                # --base-dir, --hls-window, --segment-duration, --web-url,
                                # --dev-serve-files, --dev-seed-admin
```
Installed as `mirrorr = "mirrorr.main:main"` (`[project.scripts]`).

### Programmatic Usage
```python
from mirrorr.core import MirrorrCore
from mirrorr.startup.config import MirrorrSettings

settings = MirrorrSettings(base_dir="./my_data")
core = MirrorrCore(settings)

# Any of these:
await core.run_async()          # async, blocks until shutdown
core.run_blocking()             # sync, calls asyncio.run internally
task = core.to_task()           # returns asyncio.Task[None]
```

### Environment File Usage
```python
settings = MirrorrSettings.create_from_env(".env")
core = MirrorrCore(settings)
core.run_blocking()
```

### `MirrorrSettings` (shipped with Mirrorr)
All paths default relative to `base_dir`. `MirrorrSettings.create_from_env()` reads env vars / .env file via `pydantic-settings`.

| Setting | Default | Purpose |
|---|---|---|
| `base_dir` | `.` | Root for all Mirrorr state |
| `content_dir` | `{base_dir}/content` | Video data + sessions |
| `autoruns_dir` | `{content_dir}/autoruns` | Scheduled session storage |
| `recordings_dir` | `{content_dir}/recordings` | Permanent recording storage |
| `engines_dir` | `{base_dir}/plugins/engines` | Engine plugin .py files |
| `resolvers_dir` | `{base_dir}/plugins/resolvers` | Resolver plugin .py files |
| `sync_default_plugins` | `True` | Copy the bundled built-ins into the plugin dirs on boot (only when missing/changed); `False` = manage plugins yourself |
| `companions_dir` | `{base_dir}/companions` | Companion process log dir (companions are spawned on demand, never installed) |
| `nats_server_dir` | `{base_dir}/nats-server` | Local NATS binary |
| `binaries_dir` | `{base_dir}/binaries` | Downloaded binaries |
| `db_file` | `{base_dir}/mirrorr_data.db` | SQLite database |
| `nats_port` | `4222` | NATS server port |
| `smoke_test_timeout_s` | `30.0` | Bound on a resolver's `smoke_test` readiness probe (Oct 15 2026) |
| `hls_window` | `60` | Sliding HLS manifest duration in seconds |
| `segment_duration` | `10` | Individual segment duration in seconds |
| `autorun_check_interval` | `10` | Seconds between autorun schedule checks |
| `use_system_ffmpeg` | `False` | Use $PATH ffmpeg |
| `use_system_nats` | `False` | Use $PATH nats-server |
| `api_host` | `localhost` | Uvicorn bind host |
| `api_port` | `8000` | Uvicorn bind port |

---

## 4. Domain Models
All models in `src/mirrorr/storage/models.py` using **SQLModel** (SQLAlchemy + Pydantic). Enums (`SessionStatus`, `AutorunStatus`, `UserRole`, `ResourceType`) live in `src/mirrorr/storage/enums.py`. Plugin ABCs (`EngineInterface`, `ResolverInterface`, `Source`, `Capabilities`) live in `src/mirrorr/plugin_api/interfaces.py`; retry schemas + helpers in `src/mirrorr/plugin_api/retry.py`.

| Model | Purpose | Status |
|---|---|---|
| **Resolver** | Plugin that resolves config → `Source` (URL + headers). `search_schema` holds the JSON Schema of its optional discovery filter model. | Implemented |
| **ResolverSource** | A named, saved `(resolver_id, resolver_config)` pair — the "resolver-only profile", reusable in any profile/session/autorun. Live: loading one fills the consumer's resolver section. | Implemented |
| **Engine** | Plugin that consumes `Source`, runs subprocesses to write HLS. Has `retry_modes_schema` dict (JSON Schema per mode). | Implemented |
| **Profile** | Ties a Resolver + JSON config to a default Engine. Has `retry_mode`/`retry_config` as defaults for sessions using this profile. | Implemented |
| **Session** | Active/past stream operation. Links Profile + Engine. Has `recording`, optional `retry_mode`/`retry_config` overrides (None = inherit from profile), `retry_attempts`, and `session_urls`. | Implemented |
| **Autorun** | Scheduled session with `start_time`/`end_time`, `recording`, optional `retry_mode`/`retry_config` overrides, links Profile + Engine | Implemented |
| **Recording** | Denormalized snapshot of a completed recording (profile/engine/resolver names, path, metadata, `size_bytes`). | Implemented |
| **Source** | Pydantic model: `url` + optional `headers` dict | Used by Resolver → Engine handoff |
| **Capabilities** | Pydantic model: `can_record` / `can_stream` | Used by Engine |
| **DiscoveryItem / DiscoveryPage** | Dataclasses (`src/mirrorr/plugin_api/interfaces.py`): one discovery result (`id`, `title`, `config`, optional `subtitle`/`image`/`description`/`meta`) and a page of them with an opaque `next_cursor`. | Implemented |
| **Companion / CompanionSpec** | A resolver's optional companion process (`ResolverInterface.companion`) — a `Companion` subclass + its config, declared in `src/mirrorr/plugin_api/companion.py`. The core spawns it on demand and shares it across sessions (`src/mirrorr/services/companions.py`). | Implemented |
| **NoRetry / RetryAlways / RetryCount / RetryOnExitCode** | Retry mode schemas (Pydantic models). Defined in `src/mirrorr/plugin_api/retry.py`, used by `EngineInterface.retry_modes` | Implemented |
| **`build_retry_modes_schema`** | Generates `{mode: {schema, default_params}}` dict for DB/API transport | Implemented |
| **`get_retry_delay` / `get_retry_max_attempts`** | Helpers that extract retry policy from mode+config | Implemented |
| **SessionStatus** | Enum (`src/mirrorr/storage/enums.py`): `initializing`, `stream_pending`, `active`, `recording`, `terminating`, `remuxing`, `finalizing`, `completed`, `failed` | Implemented |
| **AutorunStatus** | Enum (`src/mirrorr/storage/enums.py`): `scheduled`, `active`, `recording`, `terminating`, `remuxing`, `finalizing`, `completed`, `failed` | Implemented |
| **ResourceType** | Enum (`src/mirrorr/storage/enums.py`): `session`, `profile`, `autorun`, `recording`, `source`, `user` | Implemented |
| **Client** | API client identified by hashed API key, linked to many Users | Implemented |
| **User** | Username + password auth with roles (`admin`/`user`), linked to many Clients | Implemented |
| **ClientUser** | Many-to-many join table: Client ↔ User | Implemented |
| **ResourceAccess** | A per-user **view** grant: `(resource_type, resource_id, username)`, UNIQUE. An item is readable by its owner, the users granted here, and admins; a grant admits **reads only** (list row, detail, logs) — never control/update/delete/save-as-profile/export-import/linking. `username` matches `User.username` with **no FK** (same convention as `requester_user_token`), so a deleted user leaves an inert grant and a deleted owner surfaces as `owner_missing`; grants cascade away with their resource (and on `deleteUser`). | Implemented |
| **EventSubscription** | Tracks which user owns interest in which resource, for notification routing | Implemented |
| **Notification** | Notification toast for a user, triggered by major events (started, stopped, etc.) | Implemented |

---

## 5. Directory Structure
```
mirrorr-core/
├── pyproject.toml               # [project.scripts] mirrorr = "mirrorr.main:main"
├── src/mirrorr/
│   ├── main.py                  # CLI entry point (argparse): MirrorrSettings.create_from_env → MirrorrCore
│   ├── core.py                  # MirrorrCore: boot, run_async, run_blocking, to_task, shutdown
│   ├── di.py                    # DI container singleton
│   ├── _version.py              # __version__ single source of truth
│   ├── static_files/            # Bundled player pages (player.html, outplayer.html, vlc.html)
│   ├── default_plugins/         # Bundled plugins shipped with the package
│   │   ├── engines/yt_dlp_piped.py      # yt-dlp → pipe → ffmpeg → HLS
│   │   └── resolvers/static.py          # Passthrough URL + headers from config
│   ├── plugin_api/              # Canonical plugin interfaces (imported by plugin authors)
│   │   ├── interfaces.py        # EngineInterface, ResolverInterface ABCs, Source, Capabilities, DiscoveryItem/DiscoveryPage
│   │   ├── companion.py         # Companion ABC + CompanionSpec + sibling() loader (companion process base)
│   │   └── retry.py             # Retry schemas (NoRetry/RetryAlways/RetryCount/RetryOnExitCode) + helpers
│   ├── api/                     # FastAPI web server
│   │   ├── api.py               # App init, exception handlers, router registration
│   │   ├── auth.py              # Auth infrastructure: password hashing, user/client resolution, subscription/notification helpers
│   │   ├── jwt.py               # JWT token creation and validation
│   │   ├── dependencies.py      # DB session DI, AuthState (client + user + is_admin), require_auth/require_admin
│   │   ├── privileged.py        # Admin-only field declarations + per-principal response/OpenAPI stripping
│   │   ├── schemas.py           # Pydantic request/response models (incl. source + discovery)
│   │   ├── ws.py                # WebSocket event mirroring + notification push
│   │   └── routers/
│   │       ├── auth.py          # Registration, login, user management, client management, notifications
│   │       ├── crud.py          # Dynamic CRUD router generator + session control endpoints + /sources CRUD + /resolvers/{id}/discover
│   │       ├── import_export.py # Bundle-based import/export
│   │       └── logs.py          # Session logs + recording progress endpoints
│   ├── event_bus/               # NATS-based event system
│   │   ├── event.py             # Event class definitions (Pydantic + NATS subjects), incl. resolver_source.*
│   │   ├── nats.py              # NatsRegistry: connect, emit, subscribe, on()
│   │   ├── protocol.py          # EventBus abstract protocol
│   │   └── handlers/
│   │       ├── __init__.py      # Auto-imports all modules in this directory
│   │       └── handlers.py      # Process registry + lifecycle handlers + notification creation
│   ├── services/                # Process supervisors and background tasks
│   │   ├── managed_process.py   # Subprocess wrapper + event-driven lifecycle + telemetry
│   │   ├── companions.py        # Companion discovery/spawn/lease (scan the process table; no registry)
│   │   ├── process_bus.py       # In-process async event bus (pub/sub)
│   │   ├── session_supervisor.py# Per-session orchestrator (runs in own OS process)
│   │   ├── session_runner.py    # Subprocess entry points (runner, main)
│   │   ├── session_lifecycle.py # update_session/delete_session/update_autorun + remove_session_folder
│   │   ├── session_helpers.py   # Dir setup, URL building, DB loading
│   │   ├── recording.py         # Segment stash + remux-to-MP4 lifecycle
│   │   └── autorun_scheduler.py # Background loop that starts/stops autorun sessions
│   ├── startup/                 # Boot sequence and environment checks
│   │   ├── config.py            # MirrorrSettings (Pydantic model + create_from_env)
│   │   ├── ensure_db.py         # Schema sync: create tables + add/remove columns
│   │   ├── ensure_engines.py    # Thin wrapper: engine-specific extractors for generic sync
│   │   ├── ensure_resolvers.py  # Thin wrapper: resolver extractors (+ search_schema) for generic sync
│   │   ├── ensure_plugins.py    # Generic plugin sync: filesystem ↔ DB + JIT loader
│   │   ├── ensure_ffmpeg.py     # Locates/bundles FFmpeg binary
│   │   ├── ensure_nats_server.py# NatsServerManager: downloads/runs local NATS server
│   │   ├── api_bootstrap.py     # Uvicorn server startup
│   │   └── logging.py           # Loguru config with process-aware formatting
│   └── storage/                 # Database layer
│       ├── database.py          # create_db_engine(settings) → (engine, session_factory)
│       ├── models.py            # SQLModel schemas (+ backward-compat re-exports), incl. ResolverSource
│       ├── enums.py             # SessionStatus, AutorunStatus, UserRole, ResourceType
│       └── crud.py              # Generic async CRUD helpers
├── deploy/                      # nginx-http.conf, nginx-https.conf
├── docs/                        # general-client-specification.md
└── .env.example                 # Documented env template (copy to .env)
```
Runtime state (gitignored, created under `base_dir`): `content/`, `plugins/`, `binaries/`, `nats-server/`, `mirrorr_data.db*`.

---

## 6. Coding Conventions & Style Rules

### Python Style
- **Python 3.14+** (uses `type | None` union syntax, not `Optional[]`).
- **`loguru`** for all logging. Never use `print()`. Use `logger.info()`, `logger.error()`, `logger.success()`, etc.
- **`loguru` color shortcuts**: Use `logger.opt(colors=True)` with `<green>`, `<yellow>`, `<blue>` tags for highlighted values.
- **Type hints** are expected on function signatures and class attributes. Use modern syntax (`list[str]`, `dict[str, Any]`, `str | None`).
- **`async/await`** throughout. The entire DB layer, API, NATS client, and event handlers are async.

### Architecture Patterns
- **Plugins are interfaces**: Engines implement `EngineInterface`, Resolvers implement `ResolverInterface` (both ABCs in `src/mirrorr/plugin_api/interfaces.py`). Default plugins live in `src/mirrorr/default_plugins/` and are synced into `{engines_dir}` / `{resolvers_dir}` at boot (rewritten only when missing or changed); operator plugins live in those dirs directly. Set `sync_default_plugins=False` (`SYNC_DEFAULT_PLUGINS=false`) to skip the built-ins entirely — the dirs are still created, and boot still requires at least one engine and one resolver.
- **Plugins are stateless**: They are loaded JIT via `importlib`, instantiated, used, and discarded. No persistent state in plugins.
- **Plugins are hash-verified**: `ensure_plugins.py` provides a generic `sync_plugins_db()` that `ensure_engines.py` and `ensure_resolvers.py` call with plugin-specific extractors. JIT loaders verify hashes before execution.
- **Plugins declare schemas for their config**: Resolvers expose `config_model → model_json_schema()`. Engines expose `retry_modes → dict[str, type[BaseModel]]` → serialized via `build_retry_modes_schema()`. Both are stored as JSON columns on their DB rows.
- **Resolvers may expose discovery**: Optional `ResolverInterface` members — `discovery_model` (Pydantic filter model, synced to `Resolver.search_schema` by the resolver extractor), `discovery_has_catalog`, and `async browse(params, cursor, context)` / `async search(query, params, cursor, context)` returning `DiscoveryPage`. `POST /resolvers/{id}/discover` runs `browse` when no query is given and `search` when one is; both return items a source can be saved from.
- **Resolvers may declare a companion process**: Optional `ResolverInterface.companion` returns a `CompanionSpec` (a `Companion` subclass + its session-independent config). The resolver loads the companion module with `sibling(__file__, "<module>")` (a sibling `.py` in `resolvers/`), returns the spec, and in `resolve` calls `await acquire(spec, context.companions_dir)` for `(base_url, lease)`, holding the lease on `self` and closing it in `stop`. There is no registry: `services/companions.py` discovers live companions by scanning the process table for the `--mirrorr-companion` marker and probing `/__companion__` (identity = name + source hash + config), reuses a match, or spawns one via `ManagedProcess` (detached, `start_new_session`) and arbitrates a spawn race by lowest pid. A lease is a *shared* `flock` on the companion's lock file (`{companions_dir}/{name}-{identity-hash}.lock`), so the kernel owns the holder count — a crashed holder cannot leak a process and the count cannot drift; companions self-reap once no shared lock has been held for `IDLE_TTL`. Companion names must be globally unique (`_companion_validator` in `ensure_resolvers.py`).
- **Resolvers may define a startup probe**: Optional `ResolverInterface.smoke_test(source, config, context)` — async, **raise to fail**, base implementation a **no-op** (existing plugins unaffected). The supervisor calls it **unconditionally** right after `resolve()`, bounded by `asyncio.wait_for(…, smoke_test_timeout_s)` (default 30 s, added Oct 15 2026); a raise is an ordinary failed attempt on the existing retry path (row kept, reason in `attempts[-1].reason`).
- **Sources are the "resolver-only profile"**: `ResolverSource` is just a named `(resolver_id, resolver_config)` pair, served by a dedicated `/sources` router in `crud.py` (ownership-scoped, `PrivilegedRoute`, cursor pagination) with `resolver_source.{created,updated,deleted}` events. It is live config to load, not a link to a running thing.
- **Retry modes are engine-driven**: Each engine inherits a default `{none, always, count}` retry set via `EngineInterface.retry_modes`. Engines can override this property to customize available modes. The supervisor reads `Session.effective_retry_mode()` + `Session.effective_retry_config()` (session override → profile default → hardcoded default) and loops `_run_attempt()` until success, stop, or exhaustion.
- **Events are typed Pydantic models**: Each event is a class with a `ClassVar[str]` subject. Register handlers with `@bus.on(MirrorrEvent.EVENT_NAME)`.
- **Long-running work happens in separate OS processes**: The event handler for `SessionCreated` spawns `multiprocessing.Process`. The supervisor must be fully self-contained.
- **DB schema auto-syncs**: Add/remove columns in SQLModel classes and `ensure_db.py` handles ALTER TABLE at startup. No manual migrations. A constraint change SQLite cannot ALTER is applied by a full table rebuild, which pins `PRAGMA foreign_keys=OFF` **and** `PRAGMA legacy_alter_table=ON` for its duration (both saved and restored in a `finally`): without them the `RENAME TO _old_<t>` rewrites every child's `REFERENCES` to the `_old_*` name (schema-level, **even with zero child rows**) and the final `DROP TABLE _old_<t>` trips it — `legacy_alter_table` alone is not enough (Oct 15 2026).
- **All dependencies are passed, never global**: `MirrorrSettings` is passed to every subsystem. No module-level singletons for settings, DB engine, or session factory. The only singleton is the NATS event bus (`bus`).
- **Event mapping lives in the CRUD router**: `event_map` dict maps model classes to their `(created, updated, deleted)` event tuples. Domain models do NOT carry event references.
- **Supervisor-owned fields are protected**: `PUT /sessions/{id}` strips `status`, `recording`, `retry_attempts`, `started_at`, `ended_at`. Clients must use dedicated control endpoints.
- **Admin-only fields are declared once**: `api/privileged.py` holds the single field→model map; `PrivilegedRoute` strips those fields from every response and `strip_openapi` removes them from the schema served to a non-admin. Extend by adding to the map — never by branching on `is_admin` in a route. The browser half is a second build (`admin.html`), not a runtime role check.
- **View grants are read-only**: `resource_access` (table: `ResourceType` + `resource_id` + `username`) is admitted on **read handlers only** — the five detail GETs and `GET /sessions/{id}/logs` via `crud._require_read_access` (owner **or** admin **or** a grant), and the list endpoints via `_get_paginated_for_user` (owner **OR** a correlated grant EXISTS). `_require_owner_or_admin` / `_require_session_owner` stay unchanged for writes, control, delete, save-as-profile, export/import and linking a profile/source into another principal's own object. Admin management is the five `/admin/resources*` routes in `routers/auth.py` (admin-only; owner transfer, list, viewer grant/revoke).

### Import Conventions
- Settings: `MirrorrSettings` passed via constructor. No module-level import of a settings singleton.
- Database: `from mirrorr.storage.database import create_db_engine` → called with settings, returns `(engine, session_factory)`.
- Models: `from mirrorr.storage.models import Session, Profile, ...`
- Enums: `from mirrorr.storage.enums import SessionStatus, ...`
- Plugin ABCs: `from mirrorr.plugin_api.interfaces import EngineInterface, ...`
- Events: `from mirrorr.event_bus.nats import bus` and `from mirrorr.event_bus.event import MirrorrEvent`.
- CRUD: `from mirrorr.storage.crud import get_all, get_by_id, create, update, delete`

### File Organization
- **`src/mirrorr/`** contains all core application code (API, event bus, services, storage, startup, core).
- **`src/mirrorr/default_plugins/`** contains bundled plugins shipped with the package.
- **`src/mirrorr/plugin_api/`** contains the canonical plugin interfaces (`interfaces.py`, `retry.py`) imported by plugin authors.
- **`src/mirrorr/static_files/`** contains bundled player pages served by the API (`player.html`, `outplayer.html`, `vlc.html`), copied into a session folder only when it is first created; `player.html` autoplays muted, plays HLS through the `<hlsjs-video>` media element (no hand-rolled hls.js setup), and injects a native 10-second rewind (`<media-seek-button seconds="-10">`) as the control-bar sibling immediately before the play button — the packaged skin renders its bar in a shadow root and exposes no slot for extra controls, so it is inserted by shadow-DOM lookup keyed on the public `media-play-button` element and is simply omitted if a future skin release stops rendering one.
- **User plugin dirs** (`plugins/engines/`, `plugins/resolvers/`) are created at runtime relative to `base_dir`.
- **Dev file serving**: `dev_serve_files=True` mounts `content_dir` as static files (dev only); production serves `/content/` via nginx (`deploy/`).
- **`binaries/`** is for downloaded NATS server and FFmpeg binaries (gitignored).

---

## 7. Known Issues & WIP Gaps

### Implemented (formerly gaps — now done)
- **CLI**: `mirrorr` console script (`src/mirrorr/main.py`, full argparse: `--host/--port/--nats-port/--base-dir/--hls-window/--segment-duration/--web-url/--dev-serve-files/--dev-seed-admin`).
- **HTTP file serving**: dev mode via `dev_serve_files` (mounts `content_dir`); production via nginx `deploy/` configs.

### Structural Concerns
- **Import/export bundles do not carry sources** — `import_export.py` has no `sources` array yet (deliberate deferral; bundles without sources still apply).

---

## 8. Key File Quick Reference

| File | What it does |
|---|---|
| `src/mirrorr/main.py` | CLI entry point (`mirrorr` script). Argparse → `MirrorrSettings.create_from_env` → `MirrorrCore.run_blocking()`. |
| `src/mirrorr/core.py` | `MirrorrCore` class: boot, run_async, run_blocking, to_task, shutdown. **Main API surface.** |
| `src/mirrorr/startup/config.py` | `MirrorrSettings` (Pydantic model) + `create_from_env()` factory. Includes `web_url`, `dev_serve_files`, `nats_url`. |
| `src/mirrorr/storage/models.py` | All domain models (SQLModel tables + backward-compat re-exports), incl. `ResolverSource`. |
| `src/mirrorr/storage/enums.py` | `SessionStatus`, `AutorunStatus`, `UserRole`, `ResourceType` (incl. `source`). |
| `src/mirrorr/plugin_api/interfaces.py` | `EngineInterface`/`ResolverInterface` ABCs + `Source`/`Capabilities` + `DiscoveryItem`/`DiscoveryPage`. |
| `src/mirrorr/plugin_api/companion.py` | `Companion` ABC (base for companion processes: `/health` + `/__companion__` identity + flock-based self-reap), `CompanionSpec`, `sibling()` loader. |
| `src/mirrorr/services/companions.py` | `scan()` (process-table discovery) + `acquire()` (reuse or spawn via `ManagedProcess`, race-arbitrated) + `Lease`. |
| `src/mirrorr/plugin_api/retry.py` | Retry schemas (`NoRetry`/`RetryAlways`/`RetryCount`/`RetryOnExitCode`) + `build_retry_modes_schema` + delay/attempt helpers. |
| `src/mirrorr/storage/database.py` | `create_db_engine(settings)` → `(engine, session_factory)`. |
| `src/mirrorr/event_bus/nats.py` | `NatsRegistry` singleton (`bus`): connect, emit, on(), start_subscriptions(). |
| `src/mirrorr/event_bus/event.py` | Event class definitions. Each has a NATS subject string. |
| `src/mirrorr/event_bus/handlers/handlers.py` | Process registry + lifecycle handlers: spawns/kills supervisors, handles autorun deletion. Creates notifications for major events. |
| `src/mirrorr/services/session_supervisor.py` | Per-session orchestrator. Loads plugins JIT, resolves source, starts engine, manages retries. Composes `RecordingManager` for stash/remux. Builds `session_urls` for static files + HLS playlist. The startup gate's ready/lifecycle wait and its cancel-and-park loop are one `try/finally`, so a raise from the playable `update_session` (e.g. the row deleted concurrently) still reaps all four tasks before the exception reaches the retry loop (Oct 15 2026). |
| `src/mirrorr/services/recording.py` | `RecordingManager` dataclass: segment stash during streaming, remux-to-MP4 on finalize, Recording DB entry creation. Composed into `SessionSupervisor`. |
| `src/mirrorr/services/autorun_scheduler.py` | Background loop: creates sessions for due autoruns, stops sessions when autorun end_time passes (via NATS request/reply with feedback). |
| `src/mirrorr/services/managed_process.py` | Subprocess wrapper with event-driven lifecycle, telemetry polling, log capture. |
| `src/mirrorr/services/process_bus.py` | In-process async pub/sub bus. Topic-based message passing via `asyncio.Queue`. |
| `src/mirrorr/services/session_runner.py` | Subprocess entry points (runner, main). The runner polls its shutdown event instead of parking a thread in `Event.wait()` — `asyncio.run()` joins the default executor on close, so a parked thread kept the process alive after `supervisor.run()` returned and left a stopped session's supervisor behind. |
| `src/mirrorr/services/session_lifecycle.py` | `update_session`/`delete_session`/`update_autorun` helpers, plus `remove_session_folder()` — the single owner of a deleted session's content-folder removal (only inside `content_dir`; never the reserved `autoruns`/`recordings` roots themselves, and never a folder a kept recording's artifact lives in). |
| `src/mirrorr/services/session_helpers.py` | Dir setup, URL building, DB loading. |
| `src/mirrorr/startup/ensure_plugins.py` | Generic plugin sync: `load_plugin_jit()` + `sync_plugins_db()` with extractors. |
| `src/mirrorr/startup/ensure_engines.py` | Thin wrapper: `load_engine_jit()` + `sync_engines_db()` with engine-specific field extractors. |
| `src/mirrorr/startup/ensure_resolvers.py` | Thin wrapper: `load_resolver_jit()` + `sync_resolvers_db()` with resolver extractors (incl. `search_schema`). |
| `src/mirrorr/startup/ensure_db.py` | `ensure_db(engine)` — schema auto-migration (add/remove columns); a constraint-drift rebuild runs FK-safe (dual pragma, see §6). |
| `src/mirrorr/startup/ensure_nats_server.py` | `NatsServerManager(settings)` — downloads/runs local NATS server binary. |
| `src/mirrorr/api/routers/crud.py` | CRUD router with protected fields + ownership-based access control + session control endpoints (stop, recording enable/disable via NATS request/reply). **Reads admit view grants** (`_require_read_access`; lists via `_get_paginated_for_user`'s grant EXISTS), writes/control stay `_require_owner_or_admin`. Deleting a session reclaims it: `_reclaim_session()` stops the supervisor *then* removes its folder (a 504 from the stop request is tolerated — the reclaim settles it either way), and the removal itself belongs to `session_lifecycle.remove_session_folder()`. Subscriptions auto-created on resource creation. Also hosts the `/sources` router (`ResolverSource` CRUD) and `POST /resolvers/{id}/discover`. |
| `src/mirrorr/api/auth.py` | Auth infrastructure: password hashing (`bcrypt`), API key hashing, client/user resolution, subscription/notification helpers. |
| `src/mirrorr/api/jwt.py` | JWT token creation (`create_access_token`) and validation (`decode_access_token`) using HS256. |
| `src/mirrorr/api/routers/auth.py` | Registration, login (`/auth/register`, `/auth/login`), `/auth/me`, password change, admin user/client management, notifications. Also hosts the **admin resource-access** routes (`GET /admin/resources`; `PUT …/{type}/{id}/owner`; `GET|POST|DELETE …/{type}/{id}/access[/{username}]`) — admin-only, with server-computed `label`, `owner_missing`, `viewer_count` and read-only `system` rows for engines/resolvers. |
| `src/mirrorr/api/routers/import_export.py` | Bundle-based import/export. |
| `src/mirrorr/api/routers/logs.py` | Session logs + recording progress endpoints. |
| `src/mirrorr/api/dependencies.py` | DB session DI, `AuthState` (client, user, is_admin), `require_auth`/`require_admin`/`get_auth`/`ws_auth` dependencies. |
| `src/mirrorr/api/privileged.py` | `PRIVILEGED_FIELDS` (field → model map), `PrivilegedRoute` (response stripping), `strip_openapi` (schema stripping). Single source of truth for admin-only data. |
| `src/mirrorr/api/ws.py` | WebSocket event mirroring (user-filtered via JWT/API key) + real-time notification push (`/ws/notifications`). |
| `src/mirrorr/default_plugins/engines/yt_dlp_piped.py` | Example engine: `yt-dlp` piped to `ffmpeg` → HLS output. |
| `src/mirrorr/default_plugins/resolvers/static.py` | Example resolver: passthrough URL + headers from config. |
