# Mirrorr console — UX inventory (Phase 2)

Every surface the web build can display, with the state it can be in and where it lives. **Coverage rule:** a row is audited only when `findings.md` has at least one finding **or an explicit PASS** for it. Screenshots referenced are from the four-viewport capture in `/tmp/opencode/ui-audit/{v375,v768,v1280,v1440}/` (99 PNGs, 25 scenarios × viewports).

## 1. Entry points

| Entry | File | Notes |
|---|---|---|
| Standard app | `src/main.tsx` → `src/router.tsx` | Public build; no admin imports. |
| Admin app | `src/admin.html` → `src/admin.tsx` | Same app + `Administration` settings section + owner columns (`__ADMIN__`). |
| Capacitor shell | `mobile/` | Wraps the same web app; no separate UI. |
| Player-only view | `new-session`/detail embed `SessionPlayer` | Not a route. |

## 2. Routes and screens

| ID | Route | View file | Primary job | Screenshot scenario(s) |
|---|---|---|---|---|
| SCR-01 | `/login` | `ui/views/auth/login-view.tsx` | Sign in | `login` |
| SCR-02 | `/register` | `ui/views/auth/register-view.tsx` | Create account (first admin / invited) | `register` |
| SCR-03 | `/sessions` (index redirects here) | `ui/views/sessions/sessions-list.tsx` | See runs now, start one, open one | `sessions-list`, `sessions-empty`, `mobile-overflow` |
| SCR-04 | `/sessions/$sessionId` | `ui/views/sessions/session-detail.tsx` | Diagnose/control one run, watch it | `session-detail`, `session-detail-completed`, `session-delete-confirm` |
| SCR-05 | `/autoruns` | `ui/views/autoruns/autoruns-list.tsx` | Manage one-shot scheduled runs | `autoruns-list`, `autorun-actions-menu` |
| SCR-06 | `/autoruns/$autorunId` | `ui/views/autoruns/autorun-detail.tsx` | Inspect/edit one schedule | `autorun-detail` |
| SCR-07 | `/recordings` | `ui/views/recordings/recordings-view.tsx` | Find/download/delete a finished file | `recordings-list` |
| SCR-08 | `/profiles` | `ui/views/profiles/profiles-view.tsx` | Manage reusable capture configs and saved sources | `profiles-list`, `preset-dialog`, `sources-panel` |
| SCR-09 | `/plugins` | `ui/views/plugins/plugins-view.tsx` | See registered engines/resolvers (read-only) | `plugins` |
| SCR-10 | `/import-export` | `ui/views/import-export/import-export-view.tsx` | Move profiles/autoruns as a JSON bundle | `import-export` |
| SCR-11 | `/settings` | `ui/views/settings/settings-view.tsx` | Account, users, API clients | `settings` |
| SCR-12 | `*` (unmatched) | `ui/views/auth/not-found-view.tsx` | Recover from a bad URL | `not-found` |
| SCR-13 | `/settings#administration` | `admin-surface.tsx`, `admin-access.tsx` | Users, API clients, per-item access (admin build only) | none captured → code audit |

**Shell (present on SCR-03…11):** `AppShell` = Sidebar (rail <lg, hidden <sm) + TopBar (title, live pill, bell, avatar) + banners + `PageTransition` + BottomNav (<sm) + ToastRegion. Overlays: account menu, notification drawer, mobile overflow menu, host switcher.

## 3. State matrix

`✓` implemented · `—` not applicable · `?` must be confirmed against code (see `findings.md`).

| Surface | Loading | Empty | Error | Not-found | Denied/flagged | Dense | Audited |
|---|---|---|---|---|---|---|---|
| SCR-01 Login | ✓ boot/skeleton (?) | — | ✓ inline 401, 429, 5xx panel | — | — | — | ✅ |
| SCR-02 Register | ✓ submit pending | ✓ `has_users:false` auto-route | ✓ field + panel | — | ✓ 403 not admin | — | ✅ |
| SCR-03 Sessions | ✓ 6 skeleton cards | ✓ 3 copy variants + actions | ✓ ErrorPanel | — | — | ✓ LoadMore / auto-exhaust | ✅ |
| SCR-04 Session detail | ✓ skeleton panel | ✓ "Live URLs not configured", "No attempt recorded" | ✓ panel + Delete | ✓ "Session gone" | ✓ read-only/hidden delete while remuxing | ✓ scrollable timeline | ✅ |
| SCR-05 Autoruns | ✓ skeleton rows (?) | ✓ "No scheduled recordings." | ✓ ErrorPanel (?) | — | ✓ `issue` warning strip, needs-attention pill | ✓ rows + bulk | ✅ |
| SCR-06 Autorun detail | ✓ skeleton (?) | — (existing row) | ✓ 403 panel (?) | ✓ "Scheduled recording gone" | ✓ live-run disable + past-start warning | — | ✅ |
| SCR-07 Recordings | ✓ poster skeleton | ✓ "No recordings yet." | ✓ media 403 hint (?) | — | — | ✓ cursor pages | ✅ |
| SCR-08 Presets | ✓ skeleton rows (?) | ✓ per-section empty (?) | ✓ toast/panel (?) | — | — | ✓ two lists + bulk | ✅ |
| SCR-09 Plugins | ? | ✓ empty engines/resolvers (?) | ? | — | — | — | ✅ |
| SCR-10 Import/Export | ✓ import parse/pending | ✓ no autoruns / nothing to import | ✓ unreadable bundle banner | — | — | — | ✅ |
| SCR-11 Settings | ? | — | ? | — | — | — | ✅ |
| SCR-12 404 | — | — | — | ✓ | — | — | ✅ |
| SCR-13 Admin | ? | ✓ no users / no clients | ✓ banner (?) | — | ✓ role-gated | ✓ tables | ✅ |

## 4. Overlays (dialogs, drawers, menus)

| ID | Overlay | Opened from | File | States / notes |
|---|---|---|---|---|
| OVL-01 | New session | Sessions (header button, Fab) | `sessions/new-session-dialog.tsx` | Mode picker (profile / direct), dynamic config, fallbacks collapsed, validation, busy |
| OVL-02 | Preset editor (profile or source) | Presets create/edit, Save-as-profile | `profiles/presets-dialog.tsx` | 3-step form blocks in one dialog, type switch, config source toggle, discovery drawer, error banner |
| OVL-03 | Discovery / catalog browser | Any resolver "Browse…" | `shared/discovery-drawer.tsx` | Drawer, search, loading, "No results", error |
| OVL-04 | Autorun form (new/edit) | Autoruns list, detail | `autoruns/autorun-form-dialog.tsx` | Name/slug, start/end, mode, fallbacks, recording; past-start banner; move-end confirm |
| OVL-05 | Bulk set profile + chain | Autoruns bulk bar | `autoruns/autorun-bulk-profile-dialog.tsx` | Pick profile, edit chain, pending |
| OVL-06 | Per-item / bulk access editor | Access button on cards; bulk bar | `shared/resource-access.tsx` | Owner, users/groups, capability matrix, search, admin only |
| OVL-07 | Save as profile | Session detail/actions, autorun | `session-save-profile-button.tsx` / `autorun-actions.tsx` | Name field, error |
| OVL-08 | Stop / delete session menu | Session card & detail | `session-stop-delete-button.tsx` | Menu with Stop/Delete + ConfirmDialog; pending |
| OVL-09 | Autorun actions menu | Autorun list/detail | `autoruns/autorun-actions.tsx` | Run now, edit, duplicate?, delete confirm, save-as-profile |
| OVL-10 | Delete recording confirm | Recordings | `recordings/recordings-view.tsx` | ConfirmDialog |
| OVL-11 | Generic confirm | All destructive list actions | `components/ConfirmDialog.tsx` | Busy, danger |
| OVL-12 | Notification drawer | TopBar bell | `chrome/notification-drawer.tsx` | Empty, unread, mark read |
| OVL-13 | Account menu | TopBar avatar | `chrome/account-menu.tsx` | Profile, settings, sign out |
| OVL-14 | Mobile overflow nav | Bottom nav "More" | `chrome/bottom-nav.tsx` | Plugins, Import/Export, Settings |
| OVL-15 | File picker | Import bundle (and any upload) | `components/FilePicker.tsx` | Drag/drop, invalid file, filename |
| OVL-16 | Player error dialog | Video player | `components/videojs/ui/error-dialog.tsx` | Retry / dismiss |
| OVL-17 | Create user / API client, delete user/client, API key reveal | Admin settings | `admin-surface.tsx` | Validation, one-time key banner |

## 5. Shared components

**Primitives** (`ui/components/`): Button, IconButton, Badge, StatusChip, Banner, Toast, Spinner, Skeleton, Progress, Avatar, Hash, JsonView, EmptyState, LoadMore, BulkBar, Fab, SelectionHead.
**Controls**: Input, Textarea, Select, Checkbox, Switch, Field, FilePicker, schema-form (dynamic plugin config), control.ts.
**Containers**: Panel (+Head/Body/Foot), Table, Tabs/Segmented/TabPanel, Menu/DropdownMenu/MenuItem, Dialog/ConfirmDialog, Drawer, BulkBar, focus-scope.
**Domain**: ChainEditor, RungCard, SourceChain, AccessPanel/ResourceAccess, OpsStrip/StorageStrip, SessionTimeline, SessionUrls, RemuxProgress, SessionTelemetry, SessionStarting, SessionPlayer/SessionPlayerFrame, RecordingCard, session-title.
**Chrome**: sidebar, nav-list, topbar, bottom-nav, account-menu, notification-bell/drawer, connection-pill, health-banner, host-switcher, page-transition.
**Player** (`components/videojs/`): skin, controls, time slider, seek, volume, quality menu, playback rate, captions, status indicator, error dialog, styles.

## 6. Flows (cross-screen)

| ID | Flow | Surfaces crossed | Audited |
|---|---|---|---|
| FLW-01 | Start a session (profile mode / direct mode, with fallback chain) | SCR-03 → OVL-01 → SCR-04 | ✅ |
| FLW-02 | Watch a live run, stop it, delete it | SCR-03/04 → OVL-08 → toast | ✅ |
| FLW-03 | Save a finished run's config as a preset | SCR-04 → OVL-07 → SCR-08 | ✅ |
| FLW-04 | Schedule a one-shot recording | SCR-05 → OVL-04 → SCR-06 | ✅ |
| FLW-05 | Run a schedule now | SCR-05/06 → OVL-09 → SCR-04 | ✅ |
| FLW-06 | Bulk-retarget schedules to one profile | SCR-05 → OVL-05 | ✅ |
| FLW-07 | Create/edit a preset or saved source, browse a catalog | SCR-08 → OVL-02 → OVL-03 | ✅ |
| FLW-08 | Export/import a bundle | SCR-08/10 → OVL-15 → preview → apply | ✅ |
| FLW-09 | Find a file in recordings, open/download/delete | SCR-07 → player/confirm | ✅ |
| FLW-10 | Grant/revoke per-item access in bulk | SCR-03/05/08 → OVL-06 | ✅ |
| FLW-11 | Search + status filter + pagination on any list | SCR-03/05/07/08 | ✅ |
| FLW-12 | First-run auth: register → login → sessions | SCR-02 → SCR-01 → SCR-03 | ✅ |
| FLW-13 | Recover from an unreachable/offline recorder | Shell banners, lists, detail | ✅ |
| FLW-14 | Admin: create user/client, reveal key, delete | SCR-13 → OVL-17 | ✅ |

## 7. Coverage ledger

| Phase | Count |
|---|---|
| Screens (routes) | 13 (12 + admin section) |
| Overlays | 17 |
| Shared component files | 60+ (grouped in §5) |
| Flows | 14 |
| Screenshot scenarios | 25 × 4 viewports = 99 PNGs |
| Findings recorded | see `findings.md` |
