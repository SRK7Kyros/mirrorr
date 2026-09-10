# Mirrorr Web UI — Development Journal

## 2026-06-20 — Session 1: Architecture Analysis & Project Setup

### Backend Analysis Summary

After a thorough read of the entire mirrorr-core backend, here is what the frontend needs to support:

#### API Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | Public (first user) / Admin | Register user. First user = admin. Currently requires admin for subsequent registrations. |
| POST | `/auth/login` | API Key | Login with username/password |
| GET | `/auth/me` | JWT | Get current user info |
| POST | `/auth/change-password` | JWT | Change password |
| GET | `/auth/users` | Admin | List all users |
| DELETE | `/auth/users/{username}` | Admin | Delete user |
| GET | `/auth/clients` | Admin | List all clients |
| POST | `/auth/clients` | Public (bootstrap) / Admin | Create client |
| GET | `/sessions` | JWT | List sessions (admin=all, user=own) |
| GET | `/sessions/{id}` | JWT | Get session detail |
| POST | `/sessions` | JWT | Create session |
| DELETE | `/sessions/{id}` | JWT | Delete/stop session |
| POST | `/sessions/{session_id}/stop` | JWT | Stop session |
| POST | `/sessions/{session_id}/recording/enable` | JWT | Enable recording |
| POST | `/sessions/{session_id}/recording/disable` | JWT | Disable recording |
| GET | `/autoruns` | JWT | List autoruns |
| GET | `/autoruns/{id}` | JWT | Get autorun detail |
| POST | `/autoruns` | JWT | Create autorun |
| PUT | `/autoruns/{id}` | JWT | Update autorun |
| DELETE | `/autoruns/{id}` | JWT | Delete autorun |
| GET | `/recordings` | JWT | List recordings |
| GET | `/recordings/{id}` | JWT | Get recording detail |
| DELETE | `/recordings/{id}` | JWT | Delete recording |
| GET | `/profiles` | JWT | List profiles |
| GET | `/profiles/{id}` | JWT | Get profile detail |
| POST | `/profiles` | JWT | Create profile |
| PUT | `/profiles/{id}` | JWT | Update profile |
| DELETE | `/profiles/{id}` | JWT | Delete profile |
| GET | `/engines` | None | List engines (public) |
| GET | `/engines/{id}` | None | Get engine detail |
| GET | `/resolvers` | None | List resolvers (public) |
| GET | `/resolvers/{id}` | None | Get resolver detail |
| WS | `/ws/events` | JWT | Real-time NATS event mirror |
| WS | `/ws/notifications` | JWT | Real-time notification push |

#### Data Models
- **User**: id, username, password_hash, role (admin/user), display_name, created_at
- **Client**: id, name, api_key_hash, is_active, created_at
- **Profile**: id, name, default_engine_id, resolver_id, resolver_config, retry_mode, retry_config, requester_user_token
- **Session**: id, profile_id, autorun_id, engine_id, status, recording, retry_mode_override, retry_config_override, retry_attempts, started_at, ended_at, requester_user_token, session_urls
- **Autorun**: id, user_friendly_name, snake_case_name, profile_id, engine_id, start_time, end_time, recording, retry_mode_override, retry_config_override, requester_user_token
- **Recording**: id, user_friendly_name, snake_case_name, disk_path, content_url, profile_name, engine_name, resolver_name, started_at, ended_at, duration_seconds, size_bytes, created_at, requester_user_token
- **Engine**: id, name, description, origin, origin_hash, capabilities, retry_modes_schema
- **Resolver**: id, name, description, origin, origin_hash, config_schema
- **Notification**: id, user_id, resource_type, resource_id, event_type, title, body, read, created_at
- **EventSubscription**: id, user_id, resource_type, resource_id, created_at

#### Auth Model
- Two-layer: API key (client identity) + JWT (user identity)
- Header: `X-API-Key` for client, `Authorization: Bearer <token>` for JWT
- First registered user auto-becomes admin
- Owner isolation: non-admin users only see their own resources

#### Session States
`active` → `recording` → `remuxing` → `completed` | `failed`

#### Session Control
- `stop`, `enable_recording`, `disable_recording` via NATS request/reply

#### WebSocket Events
- `session.created`, `session.updated`, `session.deleted`
- `session.started`, `session.stopped`, `session.crashed`
- `autorun.created/updated/deleted`
- `recording.created/updated/deleted`
- `profile.created/updated/deleted`

### Registration-Approval Workflow — IMPLEMENTED ✅

**Changes made:**

1. **`src/storage/models.py`** — Added:
   - `RegistrationRequestStatus` enum: `pending`, `approved`, `denied`
   - `RegistrationRequest` model: `id`, `username` (unique+indexed), `password_hash`, `display_name`, `status`, `created_at`, `reviewed_at`, `reviewed_by`

2. **`src/api/routers/auth.py`** — Modified:
   - `POST /auth/register` now has 3 paths:
     - **First user** → creates admin directly (unchanged)
     - **Admin with auth** → creates user directly (unchanged)
     - **Non-admin, no admin auth** → files a `RegistrationRequest` with status `pending`
   - Added `GET /auth/registration-requests?status=pending` — admin lists requests
   - Added `POST /auth/registration-requests/{id}/approve` — admin approves → creates user
   - Added `POST /auth/registration-requests/{id}/deny` — admin denies

**Frontend impact:**
- Login page needs a "Register" link
- Register page: if first user, account created immediately. Otherwise shows "request submitted" message
- Admin panel needs a "Registration Requests" page to approve/deny

### Frontend Architecture Plan

```
mirrorr-web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── components.json          # shadcn/ui config
├── src/
│   ├── main.tsx
│   ├── index.css            # Tailwind base + shadcn theme vars
│   ├── lib/
│   │   ├── utils.ts         # cn() helper
│   │   ├── api.ts           # API client (fetch wrapper)
│   │   ├── ws.ts            # WebSocket manager
│   │   └── schemas.ts       # Zod schemas for API types
│   ├── hooks/
│   │   ├── use-auth.ts      # Auth state + mutations
│   │   ├── use-sessions.ts  # Session queries/mutations
│   │   ├── use-autoruns.ts  # Autorun queries/mutations
│   │   ├── use-recordings.ts
│   │   ├── use-profiles.ts
│   │   ├── use-plugins.ts   # Engines + resolvers
│   │   ├── use-notifications.ts
│   │   └── use-theme.ts     # Dark/light mode
│   ├── components/
│   │   ├── ui/              # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── app-sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── notifications-panel.tsx
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   └── register-form.tsx
│   │   ├── sessions/
│   │   │   ├── session-card.tsx
│   │   │   ├── session-detail.tsx
│   │   │   └── create-session-dialog.tsx
│   │   ├── autoruns/
│   │   │   ├── autorun-card.tsx
│   │   │   └── create-autorun-dialog.tsx
│   │   ├── recordings/
│   │   │   └── recording-card.tsx
│   │   ├── profiles/
│   │   │   ├── profile-card.tsx
│   │   │   └── create-profile-dialog.tsx
│   │   ├── plugins/
│   │   │   ├── engine-card.tsx
│   │   │   └── resolver-card.tsx
│   │   ├── dynamic-form.tsx  # Schema-driven form builder
│   │   ├── datetime-picker.tsx
│   │   ├── time-input.tsx
│   │   └── relative-datetime-input.tsx
│   └── routes/
│       ├── __root.tsx
│       ├── _auth.tsx         # Auth layout (login/register)
│       ├── _auth/login.tsx
│       ├── _auth/register.tsx
│       ├── _app.tsx          # Main app layout (sidebar, header)
│       ├── _app/index.tsx    # Dashboard
│       ├── _app/sessions/
│       │   ├── index.tsx
│       │   └── $sessionId.tsx
│       ├── _app/autoruns/
│       │   └── index.tsx
│       ├── _app/recordings/
│       │   └── index.tsx
│       ├── _app/profiles/
│       │   └── index.tsx
│       ├── _app/plugins/
│       │   └── index.tsx
│       ├── _app/settings.tsx
│       └── _app/admin/
│           └── registration-requests.tsx
```

### Tech Stack
- **Bundler**: Vite (latest)
- **Runtime**: Bun
- **Framework**: React 19
- **Routing**: TanStack Router (file-based)
- **Data**: TanStack Query v5
- **Validation**: Zod
- **UI**: shadcn/ui (latest v4 + shadcn@3.x CLI)
- **Styling**: Tailwind CSS v4
- **Theme**: next-themes for dark/light mode
- **Time**: dayjs for date manipulation
- **Forms**: react-hook-form + @hookform/resolvers (zod)

### Key Design Decisions
1. **File-based routing** with TanStack Router for type safety
2. **API client** as a thin fetch wrapper with automatic auth header injection
3. **Zod schemas** co-located with API client for type inference
4. **Dynamic forms** built from JSON schemas returned by engines/resolvers
5. **WebSocket** integration for real-time session/event updates
6. **shadcn/ui** components for all UI primitives
7. **Dark/light mode** via CSS variables + next-themes

---

*This journal will be updated chronologically as development progresses.*

---

## 2026-06-20 — Session 2: Scaffolding, Components, Pages

### What was done

1. **Backend: Registration-Approval Workflow** ✅
   - Added `RegistrationRequest` model + `RegistrationRequestStatus` enum to `src/storage/models.py`
   - Modified `POST /auth/register`: first user → auto-admin, admin → direct create, non-admin → files request
   - Added `GET /auth/status` (public, returns `{ has_users: boolean }`)
   - Added `GET /auth/registration-requests?status=pending` (admin)
   - Added `POST /auth/registration-requests/{id}/approve` (admin)
   - Added `POST /auth/registration-requests/{id}/deny` (admin)

2. **Frontend: Vite + React 19 + TypeScript** ✅
   - Scaffolded via `bun create vite . --template react-ts`
   - Configured `vite.config.ts` with TanStack Router plugin (file-based routing, auto code-splitting)
   - Configured `tsconfig.app.json` with `@/*` path alias (no `baseUrl`, TS 7.0 safe)

3. **Dependencies Installed** ✅
   - Runtime: `@tanstack/react-router`, `@tanstack/react-query`, `zod`, `tailwindcss`, `@tailwindcss/vite`, `lucide-react`, `clsx`, `tailwind-merge`, `next-themes`, `react-hook-form`, `@hookform/resolvers`, `zustand`, `class-variance-authority`, `sonner`
   - Radix UI: `@radix-ui/react-slot`, `react-dialog`, `react-dropdown-menu`, `react-select`, `react-label`, `react-tabs`, `react-tooltip`, `react-popover`, `react-separator`, `react-scroll-area`, `react-switch`, `react-checkbox`, `react-avatar`, `react-progress`
   - Dev: `@tanstack/router-plugin`

4. **shadcn/ui Setup** ✅ (manual — CLI had Windows workspace detection issues)
   - Created `components.json` (radix-luma preset, zinc base, lucide icons)
   - Created `src/index.css` with Tailwind v4 + shadcn theme variables (light + dark)
   - Created all shadcn/ui components manually:
     - `button`, `input`, `label`, `card`, `dialog`, `select`, `tabs`, `tooltip`
     - `badge`, `dropdown-menu`, `separator`, `scroll-area`, `switch`, `checkbox`
     - `avatar`, `progress`, `popover`, `alert`

5. **Auth Store (Zustand)** ✅
   - `src/stores/auth-store.ts` — persisted auth state with `zustand/persist`

6. **API Client** ✅
   - `src/lib/api.ts` — thin fetch wrapper with auto auth header injection
   - `authApi`, `sessionsApi`, `autorunsApi`, `recordingsApi`, `profilesApi`, `pluginsApi`, `notificationsApi`
   - WebSocket URL helpers for `/ws/events` and `/ws/notifications`

7. **Zod Schemas** ✅
   - `src/lib/schemas.ts` — all data model schemas + form schemas
   - Types inferred: `User`, `Engine`, `Resolver`, `Profile`, `Session`, `Autorun`, `Recording`

8. **Routes & Pages** ✅
   - `__root.tsx` — Root layout with ThemeProvider + QueryClientProvider + Toaster
   - `_auth.tsx` — Auth layout (centered, redirects if authenticated)
   - `_auth/login.tsx` — Login form with Zod validation + React Query mutation
   - `_auth/register.tsx` — Register form with first-user detection (auto-admin vs request flow)
   - `_app.tsx` — Main app layout with sidebar navigation, theme toggle, user section
   - `_app/index.tsx` — Dashboard with stat cards
   - `_app/sessions/index.tsx` — Sessions list with status badges, stop/delete actions
   - `_app/autoruns/index.tsx` — Autoruns list + create form
   - `_app/recordings/index.tsx` — Recordings list with playback links
   - `_app/profiles/index.tsx` — Profiles list + create form
   - `_app/plugins/index.tsx` — Plugins page with tabs (engines/resolvers)
   - `_app/admin/index.tsx` — Admin page with user management + registration request approval

9. **Specialized Components** ✅
   - `src/components/datetime-picker.tsx` — Custom calendar with:
     - Monday as first day of week
     - Month dropdown + year dropdown
     - Arrow navigation for prev/next month
     - Outside days not shown (grid cells empty)
     - Floating popover layout
   - `src/components/time-input.tsx` — Masked time input with:
     - HH:mm format with slot separators
     - Active segment highlighting
     - Keyboard navigation (arrow keys, Tab, colon)
     - Direct typing with auto-advance
     - Value clamping (0-23 hours, 0-59 minutes)
   - `src/components/relative-datetime-input.tsx` — Duration input with:
     - MM-DD-HH:mm:ss fields
     - Reuses TimeInput for HH:mm
     - Live auto-updating human-readable ETA ("in X months, X days, …")
   - `src/components/dynamic-form.tsx` — JSON Schema form builder:
     - Handles: string, number, integer, boolean, enum, nested objects
     - Reads `properties`, `required`, `enum`, `anyOf`, `const` from schema
     - Renders Select for enums, Switch for booleans, Input for numbers/strings
     - Recursive rendering for nested objects

### Build Status
- `bun run build` succeeds (Vite production build)
- ~2034 modules transformed, all code-split correctly

---

## 2026-06-20 — Session 3: WebSocket, Profile Page, Improved Forms

### What was done

1. **WebSocket Integration** ✅
   - `src/hooks/use-ws-events.ts` — Connects to `/ws/events`, auto-reconnects, invalidates TanStack Query caches on events
   - `src/hooks/use-ws-notifications.ts` — Connects to `/ws/notifications`, maintains live unread notification list
   - Wired into `_app.tsx` layout — both hooks auto-connect when auth token exists

2. **Notifications Panel** ✅
   - Added to the header bar with badge count
   - Popover with scrollable notification list
   - Mark-as-read and clear-all actions

3. **Profile/Settings Page** ✅
   - `_app/profile.tsx` — User info card with avatar, display name, role badge
   - Change password form with Zod validation + confirmation field
   - Added `confirm_password` to `changePasswordSchema` with `.refine()` cross-validation
   - Added "Profile" nav item to sidebar

4. **Improved Autorun Create Form** ✅
   - Profile and Engine selection via Select dropdowns (fetches from API)
   - DateTimePicker for start/end date selection
   - TimeInput for start/end time selection
   - Tabs to switch between "Pick Date & Time" and "Relative Duration" modes
   - RelativeDateTimeInput with live ETA display

5. **Improved Profile Create Form** ✅
   - Profile and Engine selection via Select dropdowns (fetches from API)
   - Resolver selection via Select dropdown
   - DynamicForm renders resolver config_schema dynamically when a resolver is selected
   - Switch component for retry mode selection

6. **Session Create Flow** ✅
   - Dialog-based create flow (Dialog component)
   - Profile selection → auto-fills engine_id from selected profile
   - Recording toggle via Switch component
   - Session cards improved: shows autorun_id, retry attempts, multiple player links, recording toggle for active sessions

7. **Cleanup** ✅
   - Removed leftover Vite template files (`App.tsx`, `App.css`)

### Build Status
- `bun run build` succeeds
- All routes properly code-split
- ~351 KB main bundle (with all shared dependencies)

### Next Steps (Future Sessions)
- Session detail page with real-time telemetry display
- Improve the recordings page with delete confirmation
- Add loading skeletons for better UX
- Consider adding a `ws.ts` module for a more robust WebSocket manager with typed event dispatch
- Mobile responsive improvements
- Consider adding a proper settings page for server configuration (admin only)

### Dev Server
To start development: `cd d:\Code\mirrorr\mirrorr-ui\mirrorr-web && bun run dev`
To build for production: `cd d:\Code\mirrorr\mirrorr-ui\mirrorr-web && bun run build`

---

## 2026-06-20 — Session 4: Complete UI Rebuild with Preset b2D1Xl3kQ

### What was done

**Complete rebuild from scratch.** All previous components, routes, and CSS were deleted. The new design uses:

- **shadcn/ui preset `b2D1Xl3kQ`** (radix-luma, zinc base, oklch colors, `rounded-4xl` corners, translucent menu style)
- **Navbar layout** instead of sidebar — top navbar with horizontal nav links, user avatar dropdown, notifications popover, theme toggle
- **Modern shadcn v4 patterns** — `data-slot` attributes, `size` props, `Slot.Root` from `radix-ui` (not `@radix-ui/react-slot`)

### Architecture

**Layout:**
- `__root.tsx` — ThemeProvider + QueryClientProvider + TooltipProvider + Toaster
- `_auth.tsx` — Minimal top bar (logo + theme toggle) + centered content
- `_app.tsx` — Sticky top navbar with: logo → nav links (desktop) → spacer → notifications → theme toggle → user dropdown → mobile menu

**Pages (9 routes, all code-split):**
- Login/Register — first-user detection
- Dashboard — stat cards
- Sessions — list + create dialog + stop/delete/recording toggle
- Autoruns — list + create dialog (DateTimePicker/TimeInput/RelativeDateTimeInput)
- Recordings — list with playback links
- Profiles — list + create dialog with DynamicForm
- Plugins — engines/resolvers tabs
- Admin — registration request approval
- Profile — user info + password change

**Custom Components:**
- `DateTimePicker` — Monday-first calendar with month/year dropdowns, floating popover
- `TimeInput` — HH:mm masked input with active segment highlighting
- `RelativeDateTimeInput` — MM-DD-HH:mm:ss with live ETA
- `DynamicForm` — JSON Schema form builder

**WebSocket:**
- `use-ws-events.ts` — auto-invalidation of TanStack Query caches
- `use-ws-notifications.ts` — live notification list with popover display

### Key Differences from Previous Build
1. **Layout**: Top navbar instead of sidebar
2. **Colors**: oklch color space (modern CSS) instead of hsl
3. **Rounded corners**: `rounded-4xl` (preset default) instead of `rounded-xl`
4. **Component API**: New shadcn v4 patterns — `size` prop, `data-slot`, `Slot.Root`
5. **Icon library**: `@remixicon/react` (preset default) + `lucide-react` for custom icons
6. **All forms use Dialog** instead of inline cards for create flows

### Build Status
- `bun run build` succeeds (374 KB main bundle, ~117 KB gzipped)
- ~2138 modules transformed
- All routes properly code-split

### Dev Server
`cd d:\Code\mirrorr\mirrorr-ui\mirrorr-web && bun run dev`

---

## 2026-06-21 — Session 5: Sidebar→Navbar Layout, Plugins Redesign, Sidebar Selection

### What was done

1. **Layout Rework: Sidebar → Navbar** ✅
   - Replaced sidebar layout with a sticky top navbar
   - Horizontal nav links for desktop, mobile hamburger menu
   - Notifications popover, theme toggle, user dropdown in navbar

2. **Plugins Viewer Redesign** ✅
   - Sidebar + detail panel layout (like other CRUD pages)
   - Schema rendering with type badges
   - Retry mode accordions
   - Raw JSON modals for inspecting schemas

3. **Dashboard Improvements** ✅
   - Stats row with live counts
   - Quick action cards (fully colored)
   - Recent sessions list

4. **Profile Creation Form Improvements** ✅
   - Two-column layout: Engine+RetryMode (left) | Resolver (right)
   - Conditional config panels below each (DynamicForm)
   - Floating submit button pattern

5. **Sidebar Selection for All CRUD Pages** ✅
   - Sessions: `selectedId` state, clickable entries with highlight, `SessionDetail` with status/duration/recording/profile/timestamps + stop/enable-recording/delete actions
   - Autoruns: `selectedId` state, clickable entries with highlight, `AutorunDetail` with name/recording/profile/engine/schedule + delete action
   - Recordings: `selectedId` state, clickable entries with highlight, `RecordingDetail` with name/duration/size/created + delete action
   - Profiles: `selectedId` state, clickable entries with highlight, `ProfileDetail` with name/retry mode/engine/resolver/config JSON + delete action
   - All detail views have "← Back" button and action bar

6. **UI Polish** ✅
   - JetBrains Mono as default font (`--font-sans`)
   - Trash icon hover effect: `hover:!text-destructive hover:!bg-destructive/10` with `!important` prefix to override ghost variant
   - Reduced gap between Engine and RetryMode selectors (`gap-1.5` with `flex`)
   - Profile creation: Engine+RetryMode share left column (`grid grid-cols-2 gap-2`), Resolver spans right column, `items-end` alignment

### Build Status
- `bun run build` succeeds (~365 KB main bundle)
- ~2138 modules transformed
- All routes properly code-split

### Dev Server
`cd d:\Code\mirrorr\mirrorr-ui\mirrorr-web && bun run dev`
