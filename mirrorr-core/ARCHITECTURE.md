# Mirrorr — Architecture & Codebase Reference

> **All-inclusive wiki for agents and developers.** This document is the single source of truth for the Mirrorr codebase — structure, data flow, conventions, and every component's responsibility.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Backend — `mirrorr-core`](#3-backend--mirrorr-core)
4. [Frontend — `mirrorr-web`](#4-frontend--mirrorr-web)
5. [Data Model](#5-data-model)
6. [API Reference](#6-api-reference)
7. [Event System (NATS)](#7-event-system-nats)
8. [Plugin System](#8-plugin-system)
9. [Session Lifecycle](#9-session-lifecycle)
10. [Recording System](#10-recording-system)
11. [Auth System](#11-auth-system)
12. [WebSocket System](#12-websocket-system)
13. [Startup & Shutdown](#13-startup--shutdown)
14. [Configuration](#14-configuration)
15. [Deployment](#15-deployment)
16. [Development](#16-development)
17. [File Reference](#17-file-reference)

---

## 1. Project Overview

Mirrorr is a **live stream management service** — it resolves stream URLs, starts recording/streaming sessions via ffmpeg, manages scheduled autoruns, and provides a web dashboard for monitoring and control.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.14, FastAPI, SQLModel, SQLite (aiosqlite), NATS |
| Frontend | React 19, TypeScript 6, Vite 8, TanStack Router + Query, Tailwind CSS v4, Radix primitives (shadcn-style), video.js |
| Messaging | Embedded NATS server (JetStream) |
| Streaming | yt-dlp, ffmpeg, HLS segments |
| Auth | JWT (HS256), bcrypt password hashing, API keys |

### Monorepo Layout

```
mirrorr/
├── .github/workflows/           ← CI: web checks, iOS sideload IPA, Android APK
├── deploy/                      ← Host deploy (deploy.sh + rendered templates)
├── docs/                        ← Console design + handoff specs
├── mirrorr-core/                ← Python backend
│   ├── ARCHITECTURE.md          ← This file
│   ├── src/                     ← All source code
│   ├── tests/                   ← Test suite
│   ├── deploy/                  ← Nginx configs (http/https)
│   ├── docs/                    ← Backend docs
│   ├── pyproject.toml           ← Python dependencies
│   └── .env                     ← Runtime config (not in repo)
└── mirrorr-web/                 ← React frontend
    ├── src/                     ← All source code ({api,ui,routes})
    ├── mobile/                  ← Capacitor 8 shell (host picker + ios|android)
    ├── scripts/                 ← deploy-web + CSS gates
    ├── package.json             ← JS dependencies
    └── vite.config.ts           ← Build config
```

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (React SPA)                         │
│  TanStack Router + Query · entity store · WebSocket connections     │
└──────────┬──────────────────────────────┬────────────────────────────┘
           │ HTTP (REST API)              │ WebSocket
           ↓                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│                     FastAPI Application (uvicorn)                   │
│  Auth middleware · CORS · Exception handlers · Static file serving  │
│                                                                     │
│  Routers:                                                           │
│  ├── /sessions, /autoruns, /recordings, /profiles, /engines, ...   │
│  ├── /auth (register, login, refresh, users, clients)               │
│  ├── /notifications                                                  │
│  ├── /import-export                                                  │
│  └── /ws/events, /ws/notifications                                  │
└──────────┬──────────────────────────────┬────────────────────────────┘
           │ SQLModel + aiosqlite         │ NATS client
           ↓                              ↓
┌─────────────────────┐    ┌──────────────────────────────────────────┐
│  SQLite Database    │    │  Embedded NATS Server (JetStream)        │
│  (WAL mode)         │    │                                          │
│                     │    │  Event bus for:                          │
│  sessions           │    │  ├── Session lifecycle events            │
│  autoruns           │    │  ├── Autorun updates                     │
│  profiles           │    │  ├── Recording events                    │
│  engines            │    │  ├── Notification triggers               │
│  resolvers          │    │  ├── Supervisor control channel          │
│  recordings         │    │  └── WS relay to frontend                │
│  users              │    └──────────┬───────────────────────────────┘
│  clients            │               │
│  subscriptions      │               ↓
│  notifications      │    ┌──────────────────────────────────────────┐
└─────────────────────┘    │  Supervisor Processes (multiprocessing)  │
                           │                                          │
                           │  Each session gets its own process:      │
                           │  ├── SessionSupervisor class             │
                           │  ├── ProcessBus (in-process events)      │
                           │  ├── ManagedProcess (subprocess wrapper) │
                           │  ├── RecordingManager (if recording)     │
                           │  └── NATS client (telemetry + control)   │
                           │                                          │
                           │  Engine plugin → yt-dlp → ffmpeg → HLS   │
                           └──────────────────────────────────────────┘
```

---

## 3. Backend — `mirrorr-core`

### Package Structure

```
src/
├── core.py                    # MirrorrCore — boot/shutdown orchestrator
├── main.py                    # CLI entry point (argparse)
├── di.py                      # DI container singleton
│
├── api/                       # HTTP layer
│   ├── api.py                 # FastAPI app, CORS, exception handlers, middleware
│   ├── auth.py                # Password/API-key hashing, user/client resolution
│   ├── dependencies.py        # FastAPI Depends: DB sessions, AuthState
│   ├── jwt.py                 # JWT create/decode (access + refresh tokens)
│   ├── schemas.py             # Pydantic request/response models
│   ├── ws.py                  # WebSocket endpoints (NATS mirror + notifications)
│   └── routers/
│       ├── auth.py            # Auth CRUD (register, login, users, clients, notifs)
│       ├── crud.py            # Session/autorun/recording/profile/engine/resolver CRUD
│       └── import_export.py   # Bundle-based import/export
│
├── event_bus/                 # NATS messaging layer
│   ├── event.py               # Pydantic event models (15 event types)
│   ├── nats.py                # NatsRegistry — connect, emit, subscribe (implements EventBus)
│   ├── protocol.py            # EventBus abstract protocol
│   └── handlers/
│       └── handlers.py        # Process registry, lifecycle handlers, notifications
│
├── plugin_api/                # Plugin interfaces (imported by plugin authors)
│   ├── __init__.py            # Re-exports everything
│   ├── interfaces.py          # EngineInterface, ResolverInterface ABCs, Source, Capabilities
│   └── retry.py               # Retry mode schemas + utilities
│
├── services/                  # Business logic
│   ├── session_supervisor.py  # SessionSupervisor class — orchestrates a session
│   ├── session_runner.py      # Subprocess entry points (runner, main)
│   ├── session_lifecycle.py   # update_session, delete_session, remove_session_folder, update_autorun
│   ├── session_helpers.py     # Dir setup, URL building, DB loading
│   ├── autorun_scheduler.py   # Background scheduler loop
│   ├── managed_process.py     # Subprocess wrapper with telemetry
│   ├── process_bus.py         # In-process async event bus
│   ├── permissions.py         # has_capability/require_capability — capability predicate
│   └── recording.py           # Segment stashing + remux-to-MP4
│
├── storage/                   # Data layer
│   ├── models.py              # SQLModel tables + backward-compat re-exports
│   ├── crud.py                # Generic CRUD operations
│   ├── database.py            # SQLAlchemy engine/session factory, WAL mode
│   └── enums.py               # SessionStatus, AutorunStatus, ResourceType
│
├── startup/                   # Bootstrap modules
│   ├── config.py              # MirrorrSettings — all configuration
│   ├── ensure_db.py           # Table creation + column sync, FK-safe rebuilds
│   ├── ensure_ffmpeg.py       # ffmpeg discovery/download
│   ├── ensure_nats_server.py  # NATS server download/start/stop
│   ├── ensure_engines.py      # Engine plugin DB sync
│   ├── ensure_resolvers.py    # Resolver plugin DB sync
│   ├── ensure_plugins.py      # Generic plugin sync (importlib, hashing)
│   └── logging.py             # Loguru setup
│
└── default_plugins/           # Bundled plugins
    ├── engines/
    │   └── yt_dlp_piped.py    # yt-dlp → ffmpeg piped engine
    └── resolvers/
        └── static.py          # Static URL resolver
```

### Key Responsibilities

| Module Group | Responsibility |
|---|---|
| `core.py` | Single entry point. Owns the boot→serve→shutdown lifecycle. Creates subsystems in order. |
| `di.py` | Holds application-wide singletons (settings, session_factory, event_bus). Avoids scattered module globals. |
| `api/` | HTTP/WS layer. Validates requests, authenticates, delegates to services, returns responses. |
| `event_bus/` | Decoupled messaging. Services emit events; handlers react. WS relay forwards to frontend. |
| `plugin_api/` | Canonical import point for plugin authors. No DB or API dependencies. |
| `services/` | Core business logic. Session orchestration, scheduling, recording, process management. |
| `storage/` | Database models and operations. SQLModel + SQLAlchemy async. |
| `startup/` | Bootstrap. Ensures all infrastructure exists (DB, ffmpeg, NATS, plugins). |

---

## 4. Frontend — `mirrorr-web`

### Package Structure

```
src/
├── main.tsx                   # Standard console entry (index.html)
├── admin.tsx                  # Admin build entry (admin.html); fills the settings-section slot
├── admin-surface.tsx          # Admin route surface
├── router.tsx                 # TanStack Router setup (guards, auth navigator)
├── app.css                    # Tailwind v4 entry (@import of ui/styles/*)
├── vite-env.d.ts
│
├── routes/
│   └── route-tree.tsx         # Route tree (TanStack Router)
│
├── ui/                        # Presentational layer — owns no data access
│   ├── chrome/                # App shell: sidebar, topbar, bottom-nav, host-switcher,
│   │                          #   account-menu, notification bell/drawer, health-banner
│   ├── components/            # 92 shared components (incl. components/videojs/)
│   ├── views/                 # One directory per surface: auth, sessions, autoruns,
│   │                          #   recordings, profiles, plugins, import-export,
│   │                          #   settings, shared
│   ├── lib/                   # cn, format, motion, clipboard, resolve-class-name
│   ├── styles/                # tokens.css (single token source), tailwind.css,
│   │                          #   base.css, components.css, layout.css, fonts.css
│   └── hooks.ts               # Shared UI hooks
│
├── api/                       # Data layer — no React components, no routing, no styles
│   ├── client.ts              # apiFetch, ApiError, single-flight token refresh
│   ├── config.ts              # getApiUrl() — the only VITE_API_URL read site
│   ├── auth.ts                # Session store + login/register/logout
│   ├── query-keys.ts          # Query-key factories + stale-time table
│   ├── query-client.ts        # The single QueryClient
│   ├── entity-store.ts        # Arrival-order-independent cache merge rules
│   ├── polling.ts             # Refetch intervals from principal + socket health
│   ├── endpoints/             # Typed REST wrappers (one function per route)
│   ├── schemas/               # Zod contracts for every response
│   ├── realtime/              # WebSocket manager + frame → cache routing
│   ├── hooks/                 # TanStack Query + external-store hooks
│   └── domain/                # Pure logic: status, time, errors, dirty, bundle, filters
│
└── test/                      # Test setup/utilities
```

The data layer is a standalone module — see `src/api/README.md` for its full contract.

### Key Responsibilities

| Module Group | Responsibility |
|---|---|
| `ui/chrome/` | The app shell — sidebar/topbar/bottom-nav, host switcher, account menu, notifications, health banner. |
| `ui/views/` | One directory per surface (auth, sessions, autoruns, recordings, profiles, plugins, import-export, settings, shared). Views fetch through `api/hooks`. |
| `ui/components/` | Shared building blocks — forms, tables, charts, status indicators, media players. |
| `ui/styles/` | The visual contract. `tokens.css` is the single token source; `tailwind.css` maps it into Tailwind v4; `components.css` keeps only the bespoke pieces. |
| `api/client.ts` | The only HTTP path — auth cookie, single-flight 401 refresh, 422 → field errors. |
| `api/endpoints/` | Typed REST wrappers, one per route. The layer never fetches ad hoc. |
| `api/schemas/` | Zod parse of every response, so server shape drift surfaces at the boundary. |
| `api/realtime/` | Two WebSockets with backoff and a polling fallback; frames route into the query cache. |
| `api/entity-store.ts` | Pure merge rules so WS / mutation / refetch writes are arrival-order independent. |

### Data Flow

1. **Page loads** → `useEntityList`/`useQuery` (`api/hooks`) fetches via `api/endpoints` → `api/client.ts`
2. **User action** → a mutation sends the request and writes the response through `entity-store.ts`
3. **Backend emits a NATS event** → `api/realtime/manager.ts` receives it on `/ws/events`
4. **Cache write** → `realtime/event-table.ts` routes the frame — authoritative frames write field-by-field, `deleted` frames remove the id
5. **Fallback** → a frame with no `data` triggers a coalesced invalidation; a dead socket falls back to polling

---

## 5. Data Model

### Entity Relationship Diagram

```
┌───────────┐     ┌──────────┐     ┌──────────┐
│  Session  │────→│ Profile  │────→│  Engine  │
│           │     │          │     │          │
│ profile_id│FK   │ engine_id│FK   │ name     │
│ autorun_id│FK→  │ resolver_│FK→  │ origin   │
│ engine_id │FK→  │  id      │     │ hash     │
│ status    │     │ resolver_│     │ caps     │
│ recording │     │  config  │     │ retry_   │
│ retry_*   │     │ retry_*  │     │  schema  │
│ session_  │     └──────────┘     └──────────┘
│  urls     │
│ attempts  │     ┌──────────┐
└─────┬─────┘     │ Resolver │
      │            │ name     │
      │ back_      │ origin   │
      │ populates  │ hash     │
      ↓            │ config_  │
┌───────────┐      │  schema  │
│  Autorun  │      └──────────┘
│           │
│ profile_id│FK
│ engine_id │FK
│ status    │
│ start_time│
│ end_time  │
└───────────┘

┌───────────┐  — Standalone, snapshot of what produced it
│ Recording │
│ profile_  │  name, engine_name, resolver_name (denormalized)
│ disk_path │
│ duration  │
│ size      │
└───────────┘

┌───────────┐     ┌────────────┐     ┌───────────┐
│   User    │────→│ClientUser  │←────│  Client   │
│ username  │     │ (M2M join) │     │ api_key_  │
│ pass_hash │     └────────────┘     │  hash     │
│ role      │                        └───────────┘
└─────┬─────┘
      │
      ├──← EventSubscription (user_id + resource_type + resource_id)
      └──← Notification (user_id + resource info + read flag)

┌────────────────┐  — per-user capability grant. No FK: username matches User.username
│ ResourceAccess │    (same convention as requester_user_token).
│ resource_type  │    UNIQUE (resource_type, resource_id, username, capability).
│ resource_id    │    capability ∈ {VIEW, OPERATE, EDIT, DELETE, SHARE, EXPORT};
│ username       │    owner and admin hold all six implicitly, and no capability
│ capability     │    implies another. Cascades away with its resource and on user delete.
└────────────────┘
```

### Enums

| Enum | Values |
|------|--------|
| `SessionStatus` | `initializing`, `stream_pending`, `active`, `recording`, `terminating`, `remuxing`, `finalizing`, `completed`, `failed` |
| `AutorunStatus` | `scheduled`, `active`, `recording`, `terminating`, `remuxing`, `finalizing`, `completed`, `failed` |
| `ResourceType` | `session`, `profile`, `autorun`, `recording`, `source`, `user` |
| `Capability` | `VIEW`, `OPERATE`, `EDIT`, `DELETE`, `SHARE`, `EXPORT` |

### Status State Machine (Session)

```
ACTIVE ──→ RECORDING ──→ TERMINATING ──→ REMUXING ──→ FINALIZING ──→ COMPLETED
  │            │              │                                      │
  └────────────┴──────────────┴──────────────────────────────────────┤
                                  FAILED (from any active state)    │
                                                                   │
COMPLETED ──→ (deleted from DB) ←──────────────────────────────────┘
```

---

## 6. API Reference

### Base URL

Default: `http://localhost:8000` (configurable via `API_HOST`/`API_PORT`)

### Authentication

All authenticated endpoints require either:
- `Authorization: Bearer <JWT>` header (user auth)
- `X-API-Key: <key>` header (client/service auth)

### Endpoints

#### Sessions

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/sessions/` | List all sessions (admin=all, user=own) | `require_auth` |
| `GET` | `/sessions/{id}` | Get session by ID | `require_auth` |
| `POST` | `/sessions/` | Create a new session | `require_auth` |
| `DELETE` | `/sessions/{id}` | Delete session (stops if active, blocks if remuxing) | `require_auth` |
| `POST` | `/sessions/{id}/stop` | Stop a running session | `require_auth` |
| `POST` | `/sessions/{id}/recording/enable` | Enable recording mid-run | `require_auth` |
| `POST` | `/sessions/{id}/recording/disable` | Disable recording mid-run | `require_auth` |

#### Autoruns

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/autoruns/` | List all autoruns | `require_auth` |
| `GET` | `/autoruns/{id}` | Get autorun by ID | `require_auth` |
| `POST` | `/autoruns/` | Create autorun | `require_auth` |
| `PUT` | `/autoruns/{id}` | Update autorun | `require_auth` |
| `DELETE` | `/autoruns/{id}` | Delete autorun (stops active session) | `require_auth` |

#### Recordings

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/recordings/` | List all recordings | `require_auth` |
| `GET` | `/recordings/{id}` | Get recording by ID | `require_auth` |
| `DELETE` | `/recordings/{id}` | Delete recording | `require_auth` |

#### Profiles

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/profiles/` | List all profiles | `require_auth` |
| `GET` | `/profiles/{id}` | Get profile by ID | `require_auth` |
| `POST` | `/profiles/` | Create profile | `require_auth` |
| `PUT` | `/profiles/{id}` | Update profile | `require_auth` |
| `DELETE` | `/profiles/{id}` | Delete profile | `require_auth` |

#### Engines & Resolvers (read-only)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/engines/` | List all engines | None |
| `GET` | `/engines/{id}` | Get engine by ID | None |
| `GET` | `/resolvers/` | List all resolvers | None |
| `GET` | `/resolvers/{id}` | Get resolver by ID | None |

#### Auth

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/auth/status` | Check if any users exist | None |
| `POST` | `/auth/register` | Register user (first = admin) | `get_auth` |
| `POST` | `/auth/login` | Login with username+password | None |
| `GET` | `/auth/me` | Current user info | `require_auth` |
| `POST` | `/auth/refresh` | Refresh access token | None |
| `POST` | `/auth/change-password` | Change password | `require_auth` |
| `GET` | `/auth/users` | List all users | `require_admin` |
| `DELETE` | `/auth/users/{username}` | Delete user | `require_admin` |
| `GET` | `/auth/clients` | List all clients | `require_admin` |
| `POST` | `/auth/clients` | Create client | `get_auth` |
| `DELETE` | `/auth/clients/{id}` | Delete client | `require_admin` |

#### Resource access & sharing

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/admin/resources` | List every item with owner/viewer-count (`?resource_type=&owner=&limit=&offset=`) | `require_admin` |
| `PUT` | `/admin/resources/{resource_type}/{id}/owner` | Transfer a resource's owner | `require_admin` |
| `GET` | `/shares/{resource_type}/{id}` | Read owner + grants (`AccessView`) | `SHARE` |
| `POST` | `/shares/{resource_type}/{id}` | Replace one user's capability set (`{username, capabilities:[…]}`) | `SHARE` |
| `DELETE` | `/shares/{resource_type}/{id}/{username}` | Clear every grant for one user | `SHARE` |

`resource_type` is `session|profile|autorun|recording|source` (owner-bearing, editable); `engine|resolver` appear as read-only `system` rows in the listing only, and `user` is not a valid access target. The `SHARE` routes are gated by `require_capability(..., Capability.SHARE)` (owner, admin or a `SHARE` holder); the three old `/admin/resources/{type}/{id}/access*` routes are removed (they now 404).

#### Notifications

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/notifications/` | List user's notifications | `require_auth` |
| `GET` | `/notifications/{id}` | Get notification | `require_auth` |
| `POST` | `/notifications/{id}/read` | Mark read | `require_auth` |
| `POST` | `/notifications/read-all` | Mark all read | `require_auth` |
| `DELETE` | `/notifications/{id}` | Delete notification | `require_auth` |

#### Import/Export

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/import-export/profiles/{id}/export` | Export profile as bundle | `require_auth` |
| `GET` | `/import-export/autoruns/{id}/export` | Export autorun as bundle | `require_auth` |
| `POST` | `/import-export/validate` | Validate bundle against installation | `require_auth` |
| `POST` | `/import-export/apply` | Apply validated bundle | `require_auth` |

#### WebSocket

| Protocol | Path | Description | Auth |
|----------|------|-------------|------|
| `WS` | `/ws/events` | NATS event mirror with entity enrichment | `ws_auth` |
| `WS` | `/ws/notifications` | Real-time notification push | `ws_auth` (required) |

### Request/Response Schemas

Request bodies use Pydantic models defined in `src/api/schemas.py`:
- `CreateSessionRequest` — `profile_id`, `engine_id`, `recording`, retry overrides
- `CreateAutorunRequest` — name, slug, profile/engine IDs, start/end times, recording flag
- `UpdateAutorunRequest` — All fields optional (partial update)
- `CreateProfileRequest` — name, engine/resolver IDs, resolver config, retry config
- `UpdateProfileRequest` — All fields optional
- Auth schemas: `LoginRequest`, `RegisterRequest`, `RefreshRequest`, `ChangePasswordRequest`

---

## 7. Event System (NATS)

### Architecture

The event bus uses an embedded NATS server with JetStream. It serves as the backbone for:
1. **Session lifecycle events** — created, started, stopped, crashed, deleted
2. **Autorun updates** — created, updated, deleted
3. **Recording events** — created, updated, deleted
4. **Profile events** — created, updated, deleted
5. **Supervisor control** — stop, enable/disable recording (request-reply)
6. **Telemetry** — per-process CPU/memory sampled at 1 Hz and coalesced per session into `session.{id}.telemetry` (the console's live process readout); raw per-process samples stay filtered from WS
7. **WS relay** — all events forwarded to connected WebSocket clients

### Event Types

| Event | Subject | Has Handler | Purpose |
|-------|---------|-------------|---------|
| `SessionCreated` | `session.created` | ✅ Spawns supervisor process | New session created |
| `SessionUpdated` | `session.updated` | ❌ WS relay only | Session fields changed |
| `SessionDeleted` | `session.deleted` | ✅ Kills supervisor process | Session removed |
| `SessionStarted` | `session.started` | ✅ Creates notification | Session became active |
| `SessionStopped` | `session.stopped` | ✅ Creates notification | Session completed |
| `SessionCrashed` | `session.crashed` | ✅ Creates notification | Session failed |
| `SessionStopRequested` | `session.{id}.control` | ✅ In supervisor (request-reply) | Control channel |
| `AutorunCreated` | `autorun.created` | ✅ Logs (scheduler picks up) | Autorun scheduled |
| `AutorunUpdated` | `autorun.updated` | ❌ WS relay only | Autorun fields changed |
| `AutorunDeleted` | `autorun.deleted` | ✅ Stops active session | Autorun removed |
| `RecordingCreated` | `recording.created` | ✅ Creates notification | Recording completed |
| `RecordingUpdated` | `recording.updated` | ❌ WS relay only | Recording changed |
| `RecordingDeleted` | `recording.deleted` | ❌ WS relay only | Recording removed |
| `ProfileCreated` | `profile.created` | ❌ WS relay only | Profile created |
| `ProfileUpdated` | `profile.updated` | ❌ WS relay only | Profile changed |
| `ProfileDeleted` | `profile.deleted` | ❌ WS relay only | Profile removed |

### In-Process Event Bus (ProcessBus)

Each `SessionSupervisor` has its own `ProcessBus` — an in-process async event bus for subprocess coordination:

| Topic | Data | Producer | Consumer |
|-------|------|----------|----------|
| `proc.{name}.stdout` | `ProcessOutput` | `ManagedProcess` | Engine plugin |
| `proc.{name}.stderr` | `ProcessOutput` | `ManagedProcess` | Engine plugin |
| `proc.{name}.exit` | `ProcessExit` | `ManagedProcess` | Engine plugin / supervisor |
| `engine.done` | `EngineDone` | Engine plugin | Supervisor |
| `engine.crashed` | `EngineCrashed` | Engine plugin | Supervisor |
| `session.stop_requested` | `None` | Shutdown watcher | Supervisor |

### Abstraction

`EventBus` protocol in `src/event_bus/protocol.py` defines the interface:
- `connect()`, `emit()`, `on()`, `start_subscriptions()`, `drain()`
- `NatsRegistry` implements this protocol
- DI container holds the active implementation

---

## 8. Plugin System

### Architecture

Plugins are Python files dropped into `engines/` or `resolvers/` directories. They implement abstract interfaces and are discovered at boot time.

### Engine Interface

```python
class EngineInterface(ABC):
    name: str                    # Unique identifier
    description: str             # Human-readable description
    capabilities: Capabilities   # can_record, can_stream
    retry_modes: dict[str, type[BaseModel]]  # Available retry strategies

    async def start(context: EngineContext, source: Source) -> list[ManagedProcess]
    async def stop(context: EngineContext, reason: str) -> None
    async def should_retry(crash, attempt, config) -> tuple[bool, float]
```

### Resolver Interface

```python
class ResolverInterface(ABC):
    name: str                    # Unique identifier
    description: str             # Human-readable description
    config_model: Type[ConfigT]  # Pydantic model for configuration

    async def resolve(config: ConfigT, context: ResolverContext) -> Source
    async def smoke_test(source: Source, config: ConfigT, context: ResolverContext) -> None
    def stop(context: ResolverContext) -> None
```

The optional `smoke_test` runs **unconditionally** after `resolve()`, bounded by
`smoke_test_timeout_s` (default 30 s), and **raises to fail**; the base implementation is a no-op.
The startup gate it belongs to is `initializing` → `stream_pending` → `active`/`recording` (Oct 15 2026).
A raise or timeout is **terminal** — the retry policy is not consulted, because the probe is the
resolver's verdict on the source (Oct 16 2026); a `resolve()` failure stays retryable.

### Loading Pipeline

1. **Boot sync** (`sync_plugins_db`):
   - Glob `*.py` in plugin directory
   - `importlib` load each file
   - Find class that subclasses `EngineInterface` / `ResolverInterface`
   - SHA-256 hash the file → `origin_hash`
   - Compare with DB: create/update/delete as needed

2. **JIT loading** (`load_plugin_jit`):
   - When a session starts, the supervisor needs the exact plugin version
   - Loads the `.py` file by `origin` name
   - Verifies hash matches DB (security check)
   - Instantiates the class

### Default Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| `yt_dlp_piped` | Engine | Pipes yt-dlp stdout → ffmpeg stdin for HLS output. Two subprocesses coordinated via `ProcessBus`. |
| `static` | Resolver | Returns a fixed URL + headers. Simplest possible resolver. |

### Retry Modes

| Mode | Schema | Behavior |
|------|--------|----------|
| `none` | `NoRetry` | No retry on crash |
| `always` | `RetryAlways` | Always restart (infinite) |
| `count` | `RetryCount` | Restart up to N times with delay |
| `exit_code` | `RetryOnExitCode` | Retry only on specific exit codes with delay |

---

## 9. Session Lifecycle

### Flow: Create → Stream → Finalize

```
1. POST /sessions/ → SESSION_CREATED event
2. Handler spawns supervisor process
3. Supervisor._boot():
   a. Load session from DB (JIT-load plugins)
   b. Connect to NATS
   c. Subscribe to control channel
4. Supervisor.run():
   a. Resolve source via resolver plugin
   b. Start engine plugin → get ManagedProcesses
   c. Wait for: engine.done | engine.crashed | session.stop_requested
5. On engine.done:
   a. If recording: remux segments → MP4 → create Recording
   b. Mark session COMPLETED
   c. Delete session DB row + folder
6. On engine.crashed:
   a. Check retry policy
   b. If retry: cleanup → reset → sleep → goto 4a
   c. If no retry: mark FAILED → delete
7. On session.stop_requested:
   a. Set status TERMINATING
   b. Stop engine + resolver
   c. Finalize (remux if recording)
```

### Session Control (NATS request-reply)

The API sends commands to the supervisor via NATS request-reply on `session.{id}.control`:

| Command | Effect |
|---------|--------|
| `stop` | Sets TERMINATING, triggers cleanup + finalize |
| `enable_recording` | Creates RecordingManager, starts stash task, sets RECORDING status |
| `disable_recording` | Stops stash task, clears RecordingManager, sets ACTIVE status |

### Status Propagation

When a session's status changes, the `session_lifecycle.py` helper:
1. Computes a diff (old → new values)
2. Commits to DB
3. Propagates to linked autorun (session status → autorun status)
4. Emits NATS events: `SESSION_UPDATED` always, plus lifecycle events (`SESSION_STARTED`, `SESSION_STOPPED`, `SESSION_CRASHED`)

---

## 10. Recording System

### Stash Phase (During Streaming)

```
┌─────────────┐     copy oldest segments     ┌─────────────┐
│  segments/  │ ──────────────────────────→  │   stash/    │
│  (HLS live) │   every N seconds            │  (archived) │
└─────────────┘                              └─────────────┘
```

- Background task runs every `segment_duration × batch_size` seconds
- Batch size = ~10% of HLS window segment count
- Copies oldest `.ts` segments before ffmpeg's `delete_segments` removes them

### Remux Phase (On Finalize)

1. Gather all segments: `stash/` + `segments/` (deduplicated)
2. Write `concat.txt` list
3. Spawn ffmpeg: `ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4`
4. Track progress via stderr parsing (frame, time, speed)
5. Emit `session.{id}.remux.progress` to NATS (frontend shows ETA)
6. On completion: move to `recordings/`, create `Recording` DB entry
7. Emit `RECORDING_CREATED`

---

## 11. Auth System

### Authentication Flow

```
┌──────────┐     POST /auth/register     ┌──────────┐
│ Frontend │ ──────────────────────────→  │ Backend  │
│          │  (first user = admin)        │          │
│          │                              │ hash pw  │
│          │  ← access_token + refresh   │ create   │
│          │                              │ user     │
│          │                              └──────────┘
│          │
│          │     POST /auth/login         ┌──────────┐
│          │ ──────────────────────────→  │ Backend  │
│          │  (username + password)       │          │
│          │  ← access_token + refresh   │ verify   │
│          │                              │ pw hash  │
│          │                              └──────────┘
│          │
│          │     POST /auth/refresh       ┌──────────┐
│          │ ──────────────────────────→  │ Backend  │
│          │  (refresh_token)             │          │
│          │  ← new access + refresh     │ verify   │
│          │                              │ rotate   │
│          │                              └──────────┘
└──────────┘
```

### Token Details

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access token | 24 hours | API authentication |
| Refresh token | 7 days | Token rotation |

- JWT signing: HS256 with configurable secret (`JWT_SECRET_KEY` env var or `mirrorr_settings.jwt_secret_key`)
- Refresh flow: deduped concurrent refresh, periodic check every 60s

### Authorization

| Role | Permissions |
|------|------------|
| `admin` | Full access to all resources |
| `user` | Own resources (the crown — `requester_user_token`, or the members of `requester_group_id` when a group holds it) **plus the capabilities granted** through `resource_access` (`VIEW`/`OPERATE`/`EDIT`/`DELETE`/`SHARE`/`EXPORT`, enforced per action; no capability implies another) |
| (API key) | Client-level access, linked to users via `ClientUser` join table |

### First User Bootstrap

When `/auth/status` returns `has_users: false`:
- First registration auto-becomes admin
- No auth required for first user
- Subsequent registrations require admin auth

---

## 12. WebSocket System

### `/ws/events` — NATS Event Mirror

```
Frontend ←── WS ───→ Backend ←── NATS ───→ Supervisor
```

- Authenticates via `?token=JWT` or `X-API-Key` header
- Subscribes to NATS wildcard `>` (all subjects)
- Filters: skips per-process `.telemetry.` samples and `_INBOX.` subjects; the coalesced `session.{id}.telemetry` frame passes
- For authenticated users: filters to subscribed resources only
- **Enrichment**: fetches full entity from DB, injects as `data` field
- Zero-roundtrip cache updates: frontend patches React Query cache directly

### `/ws/notifications` — Notification Push

- Requires authentication (closes if unauthenticated)
- On connect: sends all unread notifications from DB
- Then subscribes to NATS, pushes new notifications in real-time
- Deduplicates by notification ID

---

## 13. Startup & Shutdown

### Boot Sequence (`MirrorrCore._boot()`)

```
 1. setup_logging()                     — Loguru formatting
 2. _ensure_plugin_dirs()               — Create dirs, sync bundled default plugins
 3. settings.ensure_directories()       — Create content/autoruns/recordings dirs
 4. Validate plugins exist              — RuntimeError if no engines or resolvers
 5. create_db_engine(settings)          — Async SQLAlchemy engine (WAL mode)
 6. [optional] reset_database()         — DEV_RESET_DATABASE truncates all tables
 7. ensure_db(engine)                   — SQLModel.metadata.create_all + column sync
 8. set_session_factory(factory)        — Wire into FastAPI dependency
 9. ensure_ffmpeg(settings)             — Locate/download ffmpeg
10. sync_engines_db()                   — Filesystem → DB sync for engines
11. sync_resolvers_db()                 — Filesystem → DB sync for resolvers
12. NatsServerManager.start()           — Download/start NATS server
13. bus.connect()                       — Connect NATS client
14. bus.start_subscriptions()           — Register handler subscriptions
15. container.configure()               — Wire DI container
16. autorun_scheduler_loop()            — Start background scheduler
17. Log configuration summary
```

### Shutdown Sequence (`MirrorrCore._shutdown()`)

```
 1. Stop autorun scheduler              — Set stop_event, await 5s
 2. kill_all_supervisors()              — Signal all, wait, force-kill stragglers
 3. bus.nc.drain()                      — Drain NATS client
 4. NatsServerManager.stop()            — Terminate NATS server
 5. db_engine.dispose()                 — Dispose SQLAlchemy engine
 6. container.reset()                   — Reset DI container
```

---

## 14. Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_DIR` | `.` | Root directory for all Mirrorr state |
| `CONTENT_DIR` | `{BASE_DIR}/content` | Video data and session data |
| `AUTORUNS_DIR` | `{CONTENT_DIR}/autoruns` | Autorun session folders |
| `RECORDINGS_DIR` | `{CONTENT_DIR}/recordings` | Recording folders |
| `PLUGINS_DIR` | `{BASE_DIR}/plugins` | Plugin directory |
| `ENGINES_DIR` | `{PLUGINS_DIR}/engines` | Engine plugins |
| `RESOLVERS_DIR` | `{PLUGINS_DIR}/resolvers` | Resolver plugins |
| `SYNC_DEFAULT_PLUGINS` | `true` | Copy the bundled built-in plugins into the plugin dirs on boot (only when missing/changed) |
| `DB_FILE` | `{BASE_DIR}/mirrorr_data.db` | SQLite database path |
| `HLS_WINDOW` | `7200` | Sliding HLS manifest duration (seconds) |
| `SEGMENT_DURATION` | `10` | Individual HLS segment duration (seconds) |
| `AUTORUN_CHECK_INTERVAL` | `10` | Seconds between autorun schedule checks |
| `NATS_PORT` | `4222` | NATS server port |
| `USE_SYSTEM_FFMPEG` | `false` | Use ffmpeg from $PATH instead of bundled |
| `USE_SYSTEM_NATS` | `false` | Use nats-server from $PATH |
| `API_HOST` | `localhost` | Uvicorn bind address |
| `API_PORT` | `8000` | Uvicorn bind port |
| `WEB_URL` | `""` | Public base URL (e.g. `https://example.com`) |
| `DEV_SERVE_FILES` | `false` | Mount content_dir as static files |
| `DEV_RESET_DATABASE` | `false` | Truncate all DB tables on boot |
| `JWT_SECRET_KEY` | `""` | JWT signing secret (auto-generated if empty) |

### CLI Arguments

```
mirrorr [-c .env] [--host HOST] [--port PORT] [--nats-port PORT]
        [--base-dir DIR] [--hls-window SEC] [--segment-duration SEC]
        [--web-url URL] [--dev-serve-files]
```

### Frontend Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api` (Vite dev proxy → `:8000`) | Backend API base URL. Set it only for a cross-origin API. |

---

## 15. Deployment

### Standalone (Local)

```bash
cd mirrorr-core
uv tool install -e .
mirrorr --base-dir ./data --web-url http://localhost:8000
```

### With Nginx

Two configs provided in `deploy/`:

| Config | Use Case |
|--------|----------|
| `nginx-http.conf` | Local/LAN — HTTP only, proxies API + WebSocket, serves `/content/` as static |
| `nginx-https.conf` | VPS/public — TLS via Let's Encrypt, HTTP→HTTPS redirect, caching for `.ts`/`.mp4` |

### Process Model

```
Main Process (FastAPI + uvicorn)
├── Autorun Scheduler (asyncio task)
├── NATS Server (subprocess, managed by NatsServerManager)
├── NATS Client (async, event bus)
├── FastAPI HTTP server (uvicorn)
└── Supervisor Processes (multiprocessing.Process, daemon)
    └── SessionSupervisor
        ├── ManagedProcess: yt-dlp (subprocess)
        ├── ManagedProcess: ffmpeg (subprocess)
        ├── RecordingManager (if recording)
        ├── NATS Client (telemetry + control)
        └── ProcessBus (in-process events)
```

### Windows Considerations

- `NatsServerManager` uses Windows Job Object to prevent orphan NATS server processes
- Supervisor processes use `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` flags
- SIGINT is ignored in child processes (parent controls shutdown via `multiprocessing.Event`)

---

## 16. Development

### Prerequisites

- Python 3.14+ (managed via `uv`)
- bun (frontend runtime and package manager)
- ffmpeg (auto-downloaded if not present)

### Backend

```bash
cd mirrorr-core
uv sync                    # Install dependencies
uv run mirrorr             # Start server
uvx ty check src           # Type checking
```

### Frontend

```bash
cd mirrorr-web
bun install                 # Install dependencies
bun run dev                 # Vite dev server (proxies /api → :8000)
bun run build               # Production build
bun run typecheck           # tsc -p tsconfig.app.json --noEmit (+ node config)
bun run test:unit           # Vitest
bun run test:e2e            # Playwright (critical flows)
bun run check:tokens        # CSS gates — also check:contrast, check:collisions
```

---

## 17. File Reference

### Backend — Line Counts

Measured 2026-10-14 with `wc -l` over `src/mirrorr/`.

| File | Lines |
|------|------:|
| `core.py` | 454 |
| `main.py` | 58 |
| `di.py` | 90 |
| `_version.py` | 7 |
| `api/api.py` | 391 |
| `api/auth.py` | 166 |
| `api/dependencies.py` | 193 |
| `api/jwt.py` | 175 |
| `api/privileged.py` | 116 |
| `api/schemas.py` | 376 |
| `api/ws.py` | 502 |
| `api/routers/auth.py` | 891 |
| `api/routers/crud.py` | 1281 |
| `api/routers/import_export.py` | 785 |
| `api/routers/logs.py` | 158 |
| `event_bus/event.py` | 138 |
| `event_bus/nats.py` | 123 |
| `event_bus/protocol.py` | 47 |
| `event_bus/handlers/handlers.py` | 291 |
| `plugin_api/__init__.py` | 49 |
| `plugin_api/companion.py` | 189 |
| `plugin_api/interfaces.py` | 257 |
| `plugin_api/retry.py` | 78 |
| `services/session_supervisor.py` | 667 |
| `services/session_runner.py` | 99 |
| `services/session_lifecycle.py` | 440 |
| `services/session_helpers.py` | 136 |
| `services/autorun_scheduler.py` | 164 |
| `services/companions.py` | 204 |
| `services/housekeeping.py` | 130 |
| `services/managed_process.py` | 310 |
| `services/process_bus.py` | 91 |
| `services/recording.py` | 563 |
| `storage/models.py` | 340 |
| `storage/crud.py` | 149 |
| `storage/database.py` | 60 |
| `storage/enums.py` | 44 |
| `startup/config.py` | 387 |
| `startup/ensure_db.py` | 162 |
| `startup/ensure_ffmpeg.py` | 56 |
| `startup/ensure_nats_server.py` | 370 |
| `startup/ensure_engines.py` | 51 |
| `startup/ensure_resolvers.py` | 83 |
| `startup/ensure_plugins.py` | 194 |
| `startup/api_bootstrap.py` | 14 |
| `startup/logging.py` | 125 |
| `default_plugins/engines/yt_dlp_piped.py` | 167 |
| `default_plugins/resolvers/static.py` | 30 |

**Total: 48 modules, 11,851 lines** — 55 `.py` files / 11,907 lines including the seven `__init__.py` re-export shims.

### Frontend — Key File Counts

Measured 2026-10-14.

| Directory | Files |
|-----------|-------|
| `routes/` | 1 — the route tree |
| `ui/views/` | 40 files across 9 surfaces |
| `ui/chrome/` | 16 files (the app shell) |
| `ui/components/` | 92 files (incl. `videojs/`) |
| `ui/lib/` | 5 utilities |
| `ui/styles/` | 6 stylesheets |
| `api/` | 12 modules + `README.md`, plus `domain/`, `endpoints/`, `hooks/`, `realtime/`, `schemas/` |
