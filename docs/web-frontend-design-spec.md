# Mirrorr web — greenfield operator console · design specification

**Status:** decision-complete · **Date:** 2026-09-24 · **Target:** `mirrorr-web/` (greenfield; prior UIs are void)
**Stack (pinned):** React 19 · Vite · TanStack Router/Query · Tailwind CSS v4 · Zod · motion (`motion/react` v13)
**Form factors:** desktop ≥900px · icon rail 640–899px · compact ≤639px (Capacitor) — one codebase, one visual language
**Behavior source:** `docs/general-client-specification.md` + the functional contract in the task payload (normative). This document decides **visual structure, tokens, density, hierarchy** — never invents endpoints or behavior.

---

## 0. Design Direction (applied)

| Ref | Role here | Why it applies |
|---|---|---|
| **typeUI `enterprise` DESIGN.md** | Normative tokens (law) | IBM Plex Sans, `#0C5CAB` primary, `#09090b` surface, `#fafafa` text, 8pt grid, 4/8px radii, 12/14/16/20/24/32 scale. Every value in §1 traces here; conflicts with Layer B resolve to `enterprise`. |
| **layout-skill (Layer A)** | Shell/scroll contracts only | This is an app shell (fixed chrome + one scrolling body). Its bounded-scroll-shell (`min-block-size: 0`), named layout primitives (`scroll-body-shell`, `list-detail`, `stack`, `cluster`), and content-stress rules are executed verbatim in §3. Zero visual taste taken from it. |
| **linear.app (Layer B)** | Depth + density *reasoning* | Density reads as engineered when hierarchy is carried by **luminance steps + type weight**, not color noise: borders are hairline semi-transparent white (`rgba(255,255,255,0.05–0.08)`), elevation is background-luminance stepping (`#09090b → #0E0F12 → #14171B`), never drop shadows on content, one accent reserved for interactive/primary fills, emphasis weight between regular and bold (Plex **500** plays Linear's 510 role). Hexes are **not** copied — enterprise hexes win. |
| **kraken (spice, one)** | Badge discipline only | Markets-UI status/badge craft: tinted badge fill (12% alpha of the status hue over `bg-raised`) + high-contrast label text. **Purple brand takeover refused** — Kraken's violet appears nowhere. |
| **anti-slop (permanent)** | Prohibited defaults | No violet-indigo gradient, no Tailwind `blue-600`, no Inter/Roboto/DM Sans, no single-weight page, no three-equal-cards primary pattern, no `rounded-2xl` everywhere, no blurred `rgba(0,0,0,.1)` default lift, no emoji icons, no gradient text, no glowing borders, no repeated ALL-CAPS eyebrows, no fade-up on every section, no hover-lift on every card. Escapee maxima avoided too: not cream+serif, not acid-green terminal cosplay, not broadsheet hairlines. |

**Pushed axis — exactly one: TYPE + DENSITY HIERARCHY (Type).** The console's signature is a tight six-step type scale (12/14/16/20/24/32) run at high density — 36px table rows, 14px body base, 12px meta — with **IBM Plex Mono injected wherever the machine speaks** (IDs `#5`, `origin_hash`, `snake_case_name`, JSON config wells, API keys) and `tabular-nums` on every number (durations, sizes, countdowns, counts). The sans/mono interplay plus tracking that tightens with size (-0.02em at 32px → 0 at ≤16px) is the entire typographic moment. **Everything else is quiet:** one accent hue, semantic status colors used only as status, flat layout shells with no decorative grid theater, motion only where it has a job (§8).

**Accessory removed (deliberate subtraction):** **no drop shadows on content surfaces.** Rows, cards, inputs, badges, banners get depth from luminance steps + hairline borders only. Shadow exists on exactly one layer class — floating overlays (menu, dialog, sheet, toast, drawer) — listed in the YAML, nowhere else.

---

## 1. Token YAML (normative values)

```yaml
# Enterprise × Mirrorr operator console — DESIGN.md-compatible token block
# Rule: enterprise hexes are law; derived neutrals are real neutrals (no hue cast);
# STATUS_MAP functional roles re-bound in colors.status + §2.
name: Enterprise-Mirrorr
version: 1
mode: dark-only            # v1 ships dark theme only (payload assumption 11)

colors:
  primary: "#0C5CAB"       # accent FILL role: primary buttons, FAB, switch-on, active bars, chip tints
  secondary: "#0a4a8a"     # accent DEPTH role: primary-button hover/pressed, STATUS processing tint
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"
  surface: "#09090b"       # = bg-base
  text: "#fafafa"          # = text-primary
  neutral: "#09090b"       # enterprise neutral == surface (official format compatibility)

  # derived surface ladder — Linear luminance-stepping reasoning over enterprise surface
  bg-base: "#09090b"       # page canvas; inset wells
  bg-panel: "#0E0F12"      # sidebar, topbar, compact app bar, tab bar, drawer chrome
  bg-raised: "#14171B"     # cards, table rows, inputs, menus, dialogs, toasts, skeletons
  fill-hover: "rgba(255,255,255,0.04)"    # row/nav/button ghost hover
  fill-active: "rgba(255,255,255,0.07)"   # pressed ghost, active nav item
  overlay-backdrop: "rgba(0,0,0,0.85)"    # dialog/sheet scrim

  # hairline border system (Linear border-as-depth)
  border-subtle: "rgba(255,255,255,0.05)"   # row dividers, chrome seams
  border-standard: "rgba(255,255,255,0.08)" # cards, inputs, menus, wells
  border-strong: "rgba(255,255,255,0.14)"   # dialog/sheet edge, topbar-bottom on compact

  # text ladder (contrast-verified in §7)
  text-primary: "#fafafa"
  text-secondary: "#9AA3B2"   # labels, descriptions, secondary cells
  text-muted: "#7E8798"       # meta/timestamps/placeholders ONLY — never body copy
  text-inverse: "#09090b"     # text on solid success/warning/danger fills

  # accent text role (same hue family as primary — NOT a second accent)
  accent-fill: "#0C5CAB"
  accent-fill-hover: "#0a4a8a"
  accent-text: "#7DB1E5"      # links, focus ring, active-indicator sole graphics, info chip fg
  accent-text-hover: "#9CC5EE"
  focus-ring: "#7DB1E5"       # 2px outline, offset 1px (re-binding of old --accent ring; see §2)

  # STATUS_MAP re-bindings — full mapping table in §2.
  # Per role: dot (graphic), fg (chip text), tint (12% alpha fill over bg-raised), solid (rare)
  status:
    scheduled:   { role_from: "--info",    token: "primary",   dot: "#7DB1E5", fg: "#7DB1E5", tint: "rgba(12,92,171,0.12)" }
    active:      { role_from: "--ok",      token: "success",   dot: "#10b981", fg: "#34D399", tint: "rgba(16,185,129,0.12)" }
    recording:   { role_from: "--danger",  token: "danger",    dot: "#ef4444", fg: "#FF6B77", tint: "rgba(239,68,68,0.12)" }
    terminating: { role_from: "--warn",    token: "warning",   dot: "#f59e0b", fg: "#FBBF24", tint: "rgba(245,158,11,0.12)" }
    remuxing:    { role_from: "--purple",  token: "secondary", dot: "#A7C0E0", fg: "#A7C0E0", tint: "rgba(10,74,138,0.12)" }
    finalizing:  { role_from: "--purple",  token: "secondary", dot: "#A7C0E0", fg: "#A7C0E0", tint: "rgba(10,74,138,0.12)" }
    completed:   { role_from: "--ok",      token: "success",   dot: "#10b981", fg: "#34D399", tint: "rgba(16,185,129,0.12)", icon: "check" }
    failed:      { role_from: "--danger",  token: "danger",    dot: "#ef4444", fg: "#FF6B77", tint: "rgba(239,68,68,0.12)",  icon: "x" }
    unknown:     { role_from: "--neutral", token: "neutral",   dot: "#9AA3B2", fg: "#9AA3B2", tint: "rgba(255,255,255,0.05)" }

typography:
  family-sans: "'IBM Plex Sans', system-ui, sans-serif"
  family-mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"   # pinned: same superfamily as the sans (one voice); JetBrains Mono rejected — no reason to split families
  sourceScale: "12/14/16/20/24/32"      # enterprise scale — law; 13px base re-bound to 14px (nearest step) in §2
  weights: [400, 500, 600]               # 500 = signature emphasis (Linear-510 role mapped to Plex Medium; Plex has no 510)
  weights-available: [100, 200, 300, 400, 500, 600, 700]   # 700+ never used (max weight 600 — no shouting)
  features-mono: "'tnum' 1, 'zero' 1"    # slashed zero + tabular figures in all machine values
  roles:
    h1:        { size: 32, weight: 600, lh: 1.15, tracking: "-0.02em", use: "auth page titles only (V2)" }
    h2:        { size: 24, weight: 600, lh: 1.2,  tracking: "-0.015em", use: "wizard/dialog hero titles (D2 steps, V10 steps)" }
    h3:        { size: 20, weight: 600, lh: 1.25, tracking: "-0.01em", use: "dialog titles, empty-state headline, detail entity name, login wordmark (20/600 per V1)" }
    body-md:   { size: 16, weight: 400, lh: 1.4,  tracking: "0", use: "form inputs (16px min on compact), topbar title 16/600, banner copy" }
    body:      { size: 14, weight: 400, lh: 1.45, tracking: "0", use: "table cells, cards, list rows — console base" }
    body-strong: { size: 14, weight: 500, lh: 1.45, tracking: "0", use: "nav labels, buttons, emphasis cells, chip labels 12/500" }
    label-caps:{ size: 12, weight: 500, lh: 1.4,  tracking: "0.06em", transform: "uppercase", use: "table column headers (<th scope=col>) and fieldset legends ONLY — never section eyebrows" }
    meta:      { size: 12, weight: 400, lh: 1.4,  tracking: "0", use: "timestamps, helper copy, muted sub-lines (snake_case_name, hints)" }
    mono:      { family: mono, size: 12, weight: 400, lh: 1.5,  tracking: "0", use: "JSON wells, config panels (bg-inset, overflow-x auto)" }
    mono-inline: { family: mono, size: 12, weight: 500, lh: 1.45, tracking: "0", use: "IDs (#5), origin_hash (12-char truncate + copy), snake_case_name, API keys, paths/URLs" }

rounded:
  sm: 4px
  md: 8px
  sourceScale: "4/8 enterprise scale (no third radius; scale with element size)"
  full: 9999px     # status dots + FAB ONLY
  # element mapping — radius scales with the element (anti-slop: one radius for all = tell)
  chip: 4px
  badge: 4px
  button: 4px
  input: 4px
  select: 4px
  switch-track: 9999px
  well: 4px
  card: 8px
  menu: 8px
  dialog: 8px
  sheet: "8px 8px 0 0"
  toast: 8px
  drawer: 0
  fab: 9999px
  row: 4px          # hover fill rounds with row, not the table

spacing:
  sm: 8px
  md: 16px
  sourceScale: "8pt baseline grid"
  scale: { hair: 2, xs: 4, sm: 8, smd: 12, md: 16, lg: 24, xl: 32, xxl: 48 }
  page-pad-desktop: 24px
  page-pad-compact: 16px
  section-gap-desktop: 24px
  section-gap-compact: 16px
  card-pad: 16px
  table-cell-pad-inline: 12px
  row-h-desktop: 36px
  card-min-h-compact: 64px

components:
  focus_ring: { width: 2px, color: "#7DB1E5", offset: 1px, style: solid }
  sidebar:    { w: 224, rail_w: 56, h: "100dvh", bg: "#0E0F12", border: "1px solid rgba(255,255,255,0.05)", brand_well_h: 48, item_h: 36, item_gap: 2, item_pad: "0 12px", item_radius: 4, icon: 16, label: "14/500", active_fill: "rgba(255,255,255,0.07)", active_bar: "2px #0C5CAB inset-inline-start" }
  topbar:     { h: 48, bg: "#0E0F12", border_bottom: "1px solid rgba(255,255,255,0.05)", title: "16/600 #fafafa", pad: "0 24px", right_gap: 8 }
  appbar:     { h: 44, bg: "#0E0F12", border_bottom: "1px solid rgba(255,255,255,0.14)", title: "16/600", target: 44, safe_top: "env(safe-area-inset-top)" }
  tabbar:     { h: 56, bg: "#0E0F12", border_top: "1px solid rgba(255,255,255,0.14)", icon: 22, icon_stroke: 2, label: "11/500", active: "#7DB1E5", inactive: "#7E8798", safe_bottom: "env(safe-area-inset-bottom)" }
  fab:        { size: 56, bg: "#0C5CAB", icon: 24, icon_color: "#fafafa", radius: 9999px, inset: "right 16px; bottom calc(56px + env(safe-area-inset-bottom) + 16px)" }
  table:      { row_h: 36, bg: transparent, row_divider: "1px solid rgba(255,255,255,0.05)", row_hover: "rgba(255,255,255,0.04)", row_selected: "rgba(255,255,255,0.07)", th: "12/500 uppercase 0.06em #7E8798", cell: "14/400 #9AA3B2", cell_strong: "14/500 #fafafa", mono_cells: "12/500 mono", radius_row: 4 }
  card:       { bg: "#14171B", border: "1px solid rgba(255,255,255,0.08)", radius: 8, pad: 16, shadow: none, hover_shadow: none }
  chip:       { h: 20, pad: "0 8px", radius: 4, label: "12/500", dot: 8, dot_gap: 6, fill: "status tint 12%", fg: "status fg", border: none, pulse_period: "1.6s" }
  badge:      { h: 18, pad: "0 6px", radius: 4, label: "12/500", solid_fg: "#09090b", unread_dot: 8 }
  button:     { h: 32, h_compact: 44, px: 12, radius: 4, label: "14/500", primary: { bg: "#0C5CAB", fg: "#fafafa", hover_bg: "#0a4a8a" }, ghost: { bg: transparent, hover: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fg: "#fafafa" }, danger: { bg: "#ef4444", fg: "#09090b", hover_bg: "#f87171" }, danger_text: { bg: transparent, fg: "#FF6B77" }, disabled: { fg: "#7E8798", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.05)" } }
  input:      { h: 32, h_compact: 44, px: 12, radius: 4, bg: "#14171B", border: "1px solid rgba(255,255,255,0.08)", text: "14/400 #fafafa", text_compact: 16, placeholder: "#7E8798", error_border: "#ef4444", label: "12/500 #9AA3B2", helper: "12/400 #7E8798" }
  select:     { trigger_h: 32, trigger_h_compact: 44, menu_bg: "#14171B", menu_radius: 8, option_h: 28, option_h_compact: 44, option_hover: "rgba(255,255,255,0.04)", option_selected: "rgba(255,255,255,0.07)" }
  switch:     { track: "32x18", track_compact: "44x24", thumb: 14, thumb_compact: 18, on_bg: "#0C5CAB", off_bg: "#14171B", off_border: "1px solid rgba(255,255,255,0.08)", thumb_fg: "#fafafa", hit_area: 44 }
  dialog:     { w: 560, w_wizard: 720, bg: "#14171B", border: "1px solid rgba(255,255,255,0.14)", radius: 8, pad: 24, title: "20/600", backdrop: "rgba(0,0,0,0.85)", shadow: "0 8px 24px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)" }
  sheet:      { bg: "#14171B", radius: "8px 8px 0 0", border_top: "1px solid rgba(255,255,255,0.14)", handle: "32x4 rgba(255,255,255,0.14)", row_h: 48, max_h: "calc(100dvh - env(safe-area-inset-top) - var(--keyboard-inset, 0px))", shadow: "0 -8px 24px rgba(0,0,0,0.45)" }
  toast:      { w: 320, bg: "#14171B", border: "1px solid rgba(255,255,255,0.08)", radius: 8, pad: 12, title: "14/500", body: "12/400", position: "bottom-right 16px (desktop) / top-center 16px below app bar (compact, max 2 stacked)", error_sticky: true, shadow: "0 8px 24px rgba(0,0,0,0.45)" }
  drawer:     { w: 360, bg: "#0E0F12", border_left: "1px solid rgba(255,255,255,0.08)", header_h: 48, row_h: 56, row_h_compact: 48, shadow: "-8px 0 24px rgba(0,0,0,0.45)" }
  skeleton:   { bg: "#14171B", shimmer: "rgba(255,255,255,0.04)", radius: 4, row_h: 36, card_h: 96, sweep: "1.4s linear infinite" }
  empty:      { icon: "none-or-20px-stroke-#7E8798", headline: "20/600 #fafafa", body: "14/400 #9AA3B2", gap: 8, max_w: 360 }
  error:      { bg: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", fg: "#FF6B77", radius: 8, pad: 16, title: "14/500", body: "12/400" }
  health_banner: { bg: "rgba(245,158,11,0.12)", fg: "#FBBF24", border_bottom: "1px solid rgba(245,158,11,0.35)", h_min: 36, label: "12/500", wrap: true }
  nav_item:   { h: 36, pad: "0 12px", radius: 4, label: "14/500", icon: 16, active_bar_w: 2 }
  tab:        { h: 44, label: "14/500", active_fg: "#7DB1E5", inactive_fg: "#7E8798", indicator: "2px #0C5CAB" }
  confirm_dialog: { typed_input_h: 32, typed_input_h_compact: 44, confirm_disabled_opacity: 0.4 }
  overflow_menu: { w: 200, item_h: 32, item_h_compact: 44, destructive_fg: "#FF6B77" }
  action_sheet: { row_h: 48, destructive_fg: "#FF6B77", destructive_order: last }
  motion_tokens:                # motion.dev — pinned; full policy §8
    micro:       { type: spring, stiffness: 400, damping: 30 }
    ui:          { type: spring, stiffness: 300, damping: 24 }
    page:        { type: spring, stiffness: 350, damping: 35 }   # RESERVED — unused in v1
    tween-enter: { duration: 0.2, ease: easeOut }
  shadow-policy: "content surfaces: none (luminance + hairlines only). overlays only: dialog/sheet/toast/drawer/menu use the shadow values above."
```

---

## 2. STATUS_MAP re-binding (functional role → enterprise semantic color)

The functional contract references functional CSS roles (`--info/--ok/--warn/--danger/--purple/--neutral`). Those names are **void**; every consumer binds through the exported `STATUS_MAP` theme map (status KEY → color token — never CSS-var name strings in domain code). Each functional role re-binds to the enterprise semantic set as follows:

| Functional role | Was (void) | Re-binds to (enterprise) | Base hex | Chip fg (on 12% tint) | Dot | Used by statuses |
|---|---|---|---|---|---|---|
| `--info` | old blue `#4F8CFF` | **`primary`** (accent family, on-dark variant) | `#0C5CAB` | `#7DB1E5` | `#7DB1E5`, static | `scheduled` |
| `--ok` | old green | **`success`** | `#10b981` | `#34D399` | `#10b981`, static | `active`, `completed` (+ ✓ icon) |
| `--warn` | old amber | **`warning`** | `#f59e0b` | `#FBBF24` | `#f59e0b`, static | `terminating` |
| `--danger` | old red | **`danger`** | `#ef4444` | `#FF6B77` | `#ef4444`, pulsing 1.6s (`recording`) / static + ✕ (`failed`) | `recording`, `failed` |
| `--purple` | old violet | **`secondary`** (enterprise deep blue — no purple ships) | `#0a4a8a` | `#A7C0E0` | `#A7C0E0`, spinner | `remuxing`, `finalizing` |
| `--neutral` | old gray | **`neutral`**/text ladder (`text-secondary`) | `#09090b` | `#9AA3B2` | `#9AA3B2`, static | `unknown` |

**Why `--purple` → `secondary`:** the enterprise palette has no violet and Kraken's purple is explicitly refused as brand takeover; `remuxing`/`finalizing` are *in-machine transitional* states — the deep working-blue (`#0a4a8a`) with a cool light label (`#A7C0E0`) reads "system is processing" without adding a second accent chromatic role. Processing states stay visually distinct from `scheduled` (`#7DB1E5` label, static dot) via the **spinner dot** + label text, never by hue alone.

**Accent split (single accent, two duties):** `#0C5CAB` is the **fill** accent (primary buttons, FAB, switch-on, active bars, chip tints); `#7DB1E5` is the **on-dark text/graphic** variant of the same hue (links, focus ring, active indicators, `scheduled`/info labels). There is exactly one accent hue (enterprise blue); `#7DB1E5` is its contrast-safe text variant, not a second system.

**Other former token re-bindings** (from the void visual system): `--bg-base` → `bg-base #09090b` · `--bg-raised` → `bg-raised #14171B` · `--bg-panel` (chrome) → `bg-panel #0E0F12` · `--accent` → `accent-fill #0C5CAB` · `--accent-text`/link → `#7DB1E5` · `--text-primary` → `#fafafa` · `--text-secondary` → `#9AA3B2` · `--text-muted` → `#7E8798` · old base 13px → **14px** (nearest step on the enterprise 12/14/16/20/24/32 scale) · old 6px dialog radius → **8px (`rounded.md`)**.

---

## 3. Shell anatomy (layout-skill contracts — scroll ownership named)

### 3.1 Desktop ≥900px — `fixed-sidenav-shell`

```
┌───────────┬──────────────────────────────────────────┐
│ sidebar   │ topbar 48px (title left · conn/ bell / user right) │
│ 224px     ├──────────────────────────────────────────┤
│ full      │ MAIN — sole vertical scroll owner         │
│ height    │ (grid row minmax(0,1fr) + min-block-size:0│
│           │  + overflow:auto)                         │
└───────────┴──────────────────────────────────────────┘
```

- **Grid:** `grid-template-columns: 224px minmax(0,1fr); grid-template-rows: 48px minmax(0,1fr); max-block-size: 100dvh;` — sidebar spans both rows; topbar = row 1 col 2; main = row 2 col 2. Shell never uses `100vh` (iOS jump) — `100dvh/100dvb` only.
- **What scrolls:** `main` **only** (`min-block-size: 0; overflow: auto`) — one scroll container per region. Sidebar and topbar are fixed, never scroll (nav is 7 items; if the viewport is short the sidebar nav becomes its own named secondary scroller `overflow-y:auto; min-block-size:0`, job = nav overflow only).
- **Sidebar (224px, `bg-panel`, 1px right `border-subtle`):** brand well 48px tall (aligns with topbar seam) with "Mirrorr" 16px/600; nav items 36px tall, 2px gap, 12px inline padding, 16px icon + 14px/500 label; order exactly Sessions · Autoruns · Recordings · Profiles · Plugins · Import/Export · Settings. **Active item:** `fill-active` background + **2px left accent bar (`#0C5CAB`, inset-inline-start)** + label `text-primary`. Hover: `fill-hover`. Bottom of sidebar: nothing (user lives in topbar).
- **Topbar (48px, `bg-panel`, 1px bottom `border-subtle`):** view title left 16px/600 `text-primary`; right cluster gap 8px — connection dot + text label (see §4 HealthBanner/conn), notification bell + unread badge (user principals only), user menu (display name → Change password / Log out). Admin users additionally see "Admin" section inside Settings only.
- **Main region:** padding 24px, **no max-width** (dense tables use full width), `stack` gap 24px between header/action row, filters, and content. Primary action (e.g. "New session") top-right of main as filled `#0C5CAB` button 32px.
- **Lists:** table layout ≥900px (real `<table>`, 36px rows), card list below 900px. Status-first scanning: status chip is leftmost meaningful column. One primary action per row, rest in overflow menu.

### 3.2 Compact rail 640–899px — `fixed-sidenav-shell` (icon-only)

- Same grid with sidebar **56px**: icon-only nav (16px icons, `aria-label` + tooltip on hover/focus = label), active = `fill-active` + 2px left accent bar. Topbar 48px unchanged. Main padding 24px → 16px. Tables fall back to card lists below 900px (rule above).
- Scroll ownership identical: main is the sole vertical scroll owner.

### 3.3 Compact ≤639px — bottom-tab shell

```
┌─────────────────────────────────────┐
│ app bar 44px + env(safe-area-inset-top) │
├─────────────────────────────────────┤
│ CONTENT — sole vertical scroll owner │  16px page padding, overflow-x: hidden
│ (min-block-size:0; overflow:auto)    │
├─────────────────────────────────────┤
│ tab bar 56px + env(safe-area-inset-bottom) │
└─────────────────────────────────────┘
        [FAB 56px circle, right 16 / bottom = tabbar+inset+16]
```

- **App bar (44px, `bg-panel`, 1px bottom `border-strong`):** left = 44px back chevron on nested routes / Mirrorr mark at tab roots; title 16px/600 ellipsized; right = connection dot **always with text label** + bell, each 44px targets. API-client mode: dot replaced by static neutral label "API client — polling every 10s".
- **Tab bar (56px + safe-area, `bg-panel`, 1px top `border-strong`):** `<nav aria-label="Primary">`, 5 slots — Sessions · Autoruns · Recordings · Profiles · **More** (opens bottom sheet: Plugins, Import/Export, Settings/Account, admin: Users + API clients, then account rows). Active tab: `#7DB1E5` icon (22px, 2px stroke) + 11px/500 label + `aria-current="page"`; inactive `#7E8798`. Route→tab map: `/sessions*`→Sessions · `/autoruns*`→Autoruns · `/recordings*`→Recordings · `/profiles*`→Profiles · `/plugins|/import-export|/settings*`→More.
- **FAB:** one 56px circular `#0C5CAB` primary action (`aria-label`, icon 24px `#fafafa`) at `right:16px; bottom: calc(56px + env(safe-area-inset-bottom) + 16px)`; omitted on read-only views (V9); replaced by in-page control when the action is a toggle (V4 recording).
- **Content:** one scroll container, 16px padding, `overflow-x:hidden` on shell (only mono wells + filter chip rows scroll internally, `overflow-x:auto`). No max-width. Bottom padding = 56px + inset + 16px so the FAB/tab bar never cover content.
- **Back:** nested views always render the app-bar chevron; Android back / iOS edge-swipe → `router.history.back()` when `canGoBack()`, else platform default. Open sheets/drawers close first and consume the event. No exit dialog.
- **Keyboard:** `--keyboard-inset` CSS var from `keyboardWillShow/Hide` (Capacitor Keyboard `resize:'none'`) pads the focused scroll container; sheets cap at `calc(100dvh − env(safe-area-inset-top) − var(--keyboard-inset))`.

### 3.4 Content-stress rules (every region, before done)

Empty → graceful EmptyState (no broken frame) · Long label (40 chars in 12) → `text-overflow:ellipsis` + `title` · Long paragraph → `content-limiter` 65ch where prose exists · Unbroken string (URL/hash/token) → `overflow-wrap:anywhere` inline; mono wells `overflow-x:auto; white-space:pre` · 375px reflow → single column, **no horizontal scrollbar** (two-dimensional scroll of primary content = fail) · no RTL in v1 (logical properties not required).

---

## 4. Component state matrices

All interactive elements: focus-visible = `2px solid #7DB1E5`, offset 1px (never `outline:none` without it). Hit floor ≥32×32px desktop (dense exception: table overflow buttons 24px), ≥44×44px compact. No hover-only information (compact has no hover). Transitions ≤120ms on background/border (0ms under reduced motion). `whileTap` scale 0.97 (`micro` token) on buttons/FAB/Tab only.

### Button (h32 desktop / h44 compact · px12 · r4 · 14/500)

| Variant | Default | Hover | Active/pressed | Focus | Disabled | Loading |
|---|---|---|---|---|---|---|
| primary (filled) | bg `#0C5CAB`, fg `#fafafa` (6.4:1) | bg `#0a4a8a` | bg `#0a4a8a` + scale .97 | ring + bg `#0a4a8a` | bg `rgba(255,255,255,.02)`, fg `#7E8798`, border `border-subtle`, cursor not-allowed | bg `#0C5CAB`, 12px spinner replaces icon left of label, label kept ("Stopping…") |
| ghost | transparent, fg `#fafafa`, border `border-standard` | bg `fill-hover` | bg `fill-active` + scale .97 | ring | as above | spinner + label kept |
| danger (filled confirm) | bg `#ef4444`, fg `#09090b` (5.5:1) | bg `#f87171` | bg `#f87171` + scale .97 | ring | as above | spinner + label |
| danger-text (row action) | transparent, fg `#FF6B77` | bg `rgba(239,68,68,.08)` | bg `rgba(239,68,68,.12)` | ring | fg `#7E8798` | spinner + label |

Copy uses verbs ("New session", "Stop", "Save as profile"). Never icon-only except FAB/back/copy/overflow (each `aria-label` + tooltip).

### Input (h32 / h44 compact · px12 · r4 · 14px desktop, **16px compact**)

| State | Visual |
|---|---|
| default | bg `#14171B`, 1px `border-standard`, text `#fafafa`, placeholder `#7E8798` |
| hover | border `rgba(255,255,255,.14)` |
| focus | ring + border `#7DB1E5` |
| filled | text `#fafafa`; mono variant (id/hash/key fields) `mono-inline` |
| disabled | bg `rgba(255,255,255,.02)`, fg `#7E8798`, no hover |
| error | border `#ef4444`, helper line below in `#FF6B77` 12px `aria-describedby` |
| required | `*` suffix in `#FF6B77` + `aria-required` |

Label 12/500 `#9AA3B2` above (8px gap); helper 12/400 `#7E8798` below (4px gap). Pair every input with `<label for>`.

### Select (trigger h32/h44 · menu r8 · option h28/h44)

| State | Visual |
|---|---|
| default | trigger = Input default + 16px chevron `#7E8798` right |
| open | trigger border `#7DB1E5`; menu `#14171B`, `border-standard`, `shadow` overlay, option hover `fill-hover`, selected `fill-active` + check 14px `#7DB1E5` |
| disabled | trigger disabled visual; chevron dim |
| error | trigger error border + helper |

Keyboard: Enter/Space opens, arrows move, Enter selects, Esc closes + returns focus to trigger. `aria-haspopup="listbox"` + `role="listbox"/"option"`.

### Switch (32×18 track / 44×24 compact · thumb 14/18 · r9999 · 44px hit area)

| State | Visual |
|---|---|
| off | track `#14171B` + `border-standard`, thumb `#fafafa` left |
| on | track `#0C5CAB`, thumb `#fafafa` right |
| disabled (e.g. `can_record:false`) | visible but disabled: track `fill-hover`, thumb `#7E8798`, tooltip + visible 12px `#7E8798` text "Engine cannot record" (never hidden) |
| pending | thumb replaced by 12px spinner; track stays at target color; no toggle until WS flips (10s → refetch) |

### Table / card row (36px desktop rows · ≥64px compact cards)

| State | Visual |
|---|---|
| default | transparent bg, 1px bottom `border-subtle`, cells 14/400 `#9AA3B2`, strong cells 14/500 `#fafafa`, mono cells `mono-inline` |
| hover | bg `fill-hover` (no lift, no shadow — flat) |
| focus (row link / overflow btn) | ring on the control, bg `fill-hover` |
| selected/hot (`?highlight=<id>`) | bg `fill-active` + 2px inset accent bar left + **2s accent ring pulse** then settles |
| pending action | row stays; control shows spinner label ("Stopping…"); chip shows "Stopping…" locally |
| deleting | 60% opacity + "Deleting…" muted chip until `session.deleted` WS or 15s poll |
| spent (autoruns) | 60% opacity, muted countdown ("spent") |
| error (control 502/504) | row-level banner under the row: ErrorPanel compact + "Force delete" ghost button |

Columns: th 12/500 uppercase 0.06em `#7E8798` (the only ALL-CAPS in the product), sticky under topbar when the main scrolls. Column priority in §6.

### StatusChip (h20 · px8 · r4 · 12/500 · dot 8px)

| Status | Fill | Label fg | Dot | Motion |
|---|---|---|---|---|
| scheduled | `rgba(12,92,171,.12)` | `#7DB1E5` | `#7DB1E5` | static |
| active | `rgba(16,185,129,.12)` | `#34D399` | `#10b981` | static |
| recording | `rgba(239,68,68,.12)` | `#FF6B77` | `#ef4444` | **pulse 1.6s** opacity .55→1 |
| terminating | `rgba(245,158,11,.12)` | `#FBBF24` | `#f59e0b` | static (label "Stopping…") |
| remuxing / finalizing | `rgba(10,74,138,.12)` | `#A7C0E0` | `#A7C0E0` | **spinner** 0.9s linear |
| completed | `rgba(16,185,129,.12)` | `#34D399` | `#10b981` + ✓ 10px | static |
| failed | `rgba(239,68,68,.12)` | `#FF6B77` | `#ef4444` + ✕ 10px | static |
| unknown | `rgba(255,255,255,.05)` | `#9AA3B2` | `#9AA3B2` | static, raw string in `title`, `console.warn` once per key |

Never color-only: dot + text label always; icons supplement. Detail headers wrap chip in `aria-live="polite"`. Chip is the leftmost meaningful table column (status-first scanning).

### Dialog / Sheet

| State | Dialog (desktop, 560px; wizards 720px) | Sheet (compact) |
|---|---|---|
| closed | unmounted | unmounted |
| opening | backdrop `rgba(0,0,0,.85)`; panel `#14171B` r8 `border-strong` + overlay shadow; enter `tween-enter` opacity 0→1 + y 8→0 | slide y 100%→0 `ui` token; drag handle 32×4 `rgba(255,255,255,.14)`; max height per §3.3 |
| open | title 20/600; body scrolls (`min-block-size:0`), sticky footer actions right (desktop) | full-width rows 48px; sticky header + footer |
| closing | exit opacity 1→0 (0.15s easeIn) then unmount (`AnimatePresence mode="wait"`) | slide down |
| disabled submit | confirm button disabled visual + `aria-disabled` | same |

Focus trapped; Esc/backdrop click = cancel (except typed-confirm: Esc cancels cleanly); focus returns to opener. Never modal-only routes.

### Toast (320px · r8 · bottom-right / top-center compact)

| State | Visual |
|---|---|
| info/success | bg `#14171B` `border-standard` + overlay shadow; icon dot `#10b981`; title 14/500 `#fafafa`; body 12/400 `#9AA3B2`; action link `#7DB1E5` (e.g. "Open") |
| error (`role="alert"`) | left 2px `#ef4444` bar; **sticky** with 32px close button; text `#FF6B77` |
| enter/exit | `tween-enter` opacity + y 8; max 2 stacked on compact, queue overflow drops oldest non-error |
| pending | n/a — toasts are terminal |

`role="status"` (errors `role="alert"`). Copy: "Session #5 completed", "Recording saved", "Autorun 'karl teardown' started", "Session #5 failed".

### Nav item / Tab

| State | Nav item (36px, r4) | Tab (compact, 44px) |
|---|---|---|
| default | transparent, icon `#7E8798`, label 14/500 `#9AA3B2` | icon `#7E8798`, label 11/500 `#7E8798` |
| hover | bg `fill-hover` | — (no hover) |
| active | bg `fill-active` + **2px `#0C5CAB` left bar** + label `#fafafa` | icon `#7DB1E5` + label `#7DB1E5` + `aria-current="page"` |
| focus | ring | ring |
| pressed | `micro` scale .97 | `micro` scale .97 |

### FAB (56px circle)

| State | Visual |
|---|---|
| default | bg `#0C5CAB`, icon 24px `#fafafa` (6.4:1) |
| hover | bg `#0a4a8a` |
| pressed | `micro` scale .95 |
| focus | ring |
| loading | icon → 20px spinner `#fafafa` |
| hidden | read-only views (V9); toggles use in-page control instead |

### Badge (unread count + tags)

| Variant | Visual |
|---|---|
| unread count | min 16×16 r4 bg `#ef4444`, 12/500 `#09090b` (5.5:1), `aria-label="N unread notifications"`; ≥10 → "9+" |
| capability (V9) | bg `rgba(255,255,255,.05)`, 12/500 `#9AA3B2` — "no record"/"no playlist"; true state uses `rgba(16,185,129,.12)` + `#34D399` — "records", "playlists" |
| role (V11/V12) | "admin" = `rgba(12,92,171,.12)` + `#7DB1E5`; "user" = neutral badge |
| autorun tag (V3) | 12px `#7DB1E5` link tag → `/autoruns/{id}` |

### Skeleton / EmptyState / ErrorPanel / HealthBanner

| Component | States/visual |
|---|---|
| Skeleton | bg `#14171B` r4 + shimmer sweep `rgba(255,255,255,.04)` 1.4s linear infinite (static under reduced motion). Geometry matches real content: 5 rows × 36px (lists), 8 cards × 96px (recordings), header block + 2 panels (detail). Never shows text. |
| EmptyState | centered column (max 360px): headline 20/600 `#fafafa` + body 14/400 `#9AA3B2` + one primary button. Copy per view (§5). No illustration, no emoji. |
| ErrorPanel | bg `rgba(239,68,68,.08)`, 1px `rgba(239,68,68,.35)`, r8, pad 16; title 14/500 `#FF6B77` ("Request failed" / "Unexpected server response"); body 12/400 `#FF6B77` carries server `detail`; ghost "Retry" button. Row-level variant: compact inline + "Force delete" offer where 502/504 control failure. |
| HealthBanner | full-width under topbar (wraps to 2 lines on compact, no h-scroll): bg `rgba(245,158,11,.12)`, text `#FBBF24` 12/500, 1px bottom `rgba(245,158,11,.35)`. Variants: "API unreachable — retrying" (health probe fail); "Live updates offline — polling every 15s" + ghost "Retry" (12-attempt WS exhaustion); API-client persistent neutral banner "Acting as API client 'ci-bot' — created resources belong to no user and produce no notifications" (bg `rgba(255,255,255,.05)`, text `#9AA3B2`). Connection dot: green `#10b981` open / amber `#f59e0b` reconnecting / red `#ef4444` offline+polling — `role="status"` + text label in tooltip (always-visible text on compact). |

### NotificationDrawer / Bell

| State | Visual |
|---|---|
| bell | 32px ghost icon button (44px compact), unread badge top-right; **not rendered at all** for API-client principals |
| drawer closed | — |
| drawer open | right drawer 360px (compact: full-screen sheet), bg `#0E0F12`, 1px left `border-standard`, header 48px ("Notifications" + "Mark all read"), footer "Clear" (loops DELETE per REST row, one confirm). Rows 56px/48px: event icon + title 14/500 + relative time 12 `#7E8798`; unread = `fill-active` bg + `#7DB1E5` icon; hover `fill-hover`. Row click → navigate + mark read. Per-row delete 24px/44px × button. List = **REST rows only**; synthetic WS frames never render here (badge/toasts only). Enter slide x `ui` token. |
| empty | EmptyState "No notifications" |
| error | ErrorPanel + Retry (REST down) |

Badge arithmetic (two components, never socket-dependent): REST unread (a) + unacknowledged synthetic WS frames (b); tuple dedupe `(resource_type, resource_id, event_type)`; read-all zeroes both; opening the drawer clears nothing.

### ConfirmDialog (incl. typed confirm)

| State | Visual |
|---|---|
| standard | Dialog 560px: title 20/600 (e.g. "Stop session #5?"), body 14/400 `#9AA3B2` ("The recording will finalize."), footer: ghost Cancel + primary or danger confirm |
| destructive w/ warning | body adds 14/500 `#FF6B77` line ("A recording is running — deleting will stop and delete it") |
| typed confirmation (delete user, revoke key) | input labeled "Type `<username>` to confirm"; confirm **disabled** (40% opacity + `aria-disabled`) until exact match; Esc/back = cancel |
| in-use block (profile delete) | body lists referencing items ("In use by 2 autoruns / 1 session"): mono names as links; confirm disabled when server forbids (400 pre-scan) |
| compact | bottom sheet: body + **Cancel (ghost) above** full-width 48px danger confirm; Esc/back/overlay = cancel |

Focus-trapped; Esc cancels; confirm label is the verb ("Stop", "Delete", "Revoke").

### OverflowMenu / ActionSheet

| State | Desktop OverflowMenu (200px) | Compact ActionSheet |
|---|---|---|
| trigger | 24px ⋯ ghost button (dense exception to 32px floor), `aria-haspopup="menu"` | 44px ⋯ button on each card |
| open | menu `#14171B` r8 `border-standard` + overlay shadow; items 32px, 14/400 `#fafafa`, hover `fill-hover`; destructive items last in `#FF6B77` | bottom sheet rows 48px, destructive last `#FF6B77`, then its ConfirmDialog as above |
| disabled item | 14/400 `#7E8798`, no hover, `aria-disabled` |
| keyboard | Esc closes, arrows cycle, focus returns to trigger | same |

Primary row action stays outside the menu (e.g. Stop button visible on active rows); the menu holds the rest. Every destructive entry still routes through its ConfirmDialog.

---

## 5. Per-view visual structure (V1–V13 + D1/D2/DynamicSchemaForm)

Behavior (data, WS, confirmations, failure UX) is normative from the functional contract and is **not** re-derived here. Each entry decides visual structure, density, and hierarchy only. Shared shell (sidebar/topbar or tab bar) wraps all authenticated views; public views (V1/V2) have no chrome.

### V1 — Login (`/login`, public)

Centered single card 360px on `bg-base` (compact: full-width form, max 400px, 16px margins). Card = `bg-raised`, 1px `border-standard`, r8, pad 24, no shadow. Vertical `stack` gap 16: wordmark "Mirrorr" 20/600 `#fafafa` (left-aligned in card), username input, password input, "Sign in" primary button (full-width 48px on compact, 32px desktop). Inline danger text 12 `#FF6B77` under the form on 401 ("Invalid username or password") — never a toast. Footer hint 12 `#7E8798` linking to `/register` only when `has_users === false`. Network error → inline `#FF6B77` "API unreachable". 429 → toast + 30s submit lockout (button disabled visual + countdown). `enterKeyHint="go"` on compact.

### V2 — Register (`/register`, public bootstrap)

Same card geometry as V1. Title "Create the first admin account" 24/600. `stack` gap 16: username, display name (optional), password, confirm password (last), note 12 `#7E8798` "This first account becomes the administrator", then "Create admin account" primary full-width on compact. 422 → per-field inline errors (Input error state). Status fetch → full-page centered spinner (`#7DB1E5` stroke).

### V3 — Sessions list (`/sessions`, home)

**Header row (main, 24px pad):** left = filter/search cluster (`cluster` primitive): search input 280px (name/id filter, loaded-pages scope) + hint row 12 `#7E8798` "Filter applies to loaded rows" + ghost "Load all" while `has_more`; right = "New session" primary button. Footer of list: "Showing N" 12 `#7E8798` + "Load more" ghost button (IntersectionObserver auto-load also fires).
**Table (≥900px):** columns in order — Status chip · ID (`mono-inline` `#5`) · Engine → Resolver (14/500, name memo-map; unmapped → `mono-inline` `#12` `#7E8798`) · Profile (link `#7DB1E5` or `—`) · Recording (8px dot: `#ef4444` on / `#7E8798` off + 12px text) · Started (relative `#9AA3B2`, absolute in `title`) · Duration (`mono-inline` tabular) · Owner (admin only) · Actions. Row 36px; live rows pulse recording chip dot per STATUS_MAP. Session rows with `autorun_id` append a 12px `#7DB1E5` "autorun" tag linking to the autorun.
**Row actions:** primary = Stop (active/recording, ghost `#FF6B77` text button) / Save as profile (completed/failed); recording toggle = Switch (disabled-but-visible when `can_record:false` + visible 12px `#7E8798` "Engine cannot record"); overflow menu holds Delete (hidden — not disabled — on remuxing/finalizing) and secondary actions. Pending "Stopping…" replaces chip label until WS confirms; row-level "still stopping…" + hard-delete offer after ~10s.
**States:** loading = 5 skeleton rows; empty = EmptyState "No sessions yet — start your first recording" + primary "New session"; error = ErrorPanel + Retry. 502/504 control failure = row-level ErrorPanel "Control unavailable — session may be stuck" + "Force delete".
**Compact (≤639px):** card list. Card anatomy (fixed): line 1 StatusChip + `mono-inline` `#id` + recording dot · line 2 engine→resolver + profile link · line 3 started (relative) + duration, 12 `#7E8798` · 44px ⋯ → ActionSheet. FAB = New session. Search input sticky under app bar.

### V4 — Session detail (`/sessions/$sessionId`, live monitor)

**Header block (no card, on `bg-base`):** StatusChip (`aria-live="polite"`) + `mono-inline` `#id` + engine→resolver 14/500 + owner (admin) + duration 20/600 tabular with 1s live tick while running + action cluster right (Stop ghost danger-text / recording switch / Save as profile / ⋯ overflow with Delete hidden on remuxing/finalizing). "Deleting…" overlay state = 60% opacity + muted chip.
**Body ≥1100px:** two columns (`list-detail` 1fr 360px, gap 24) / stacked below 1100 (order: Recording → Live URLs → Remux progress → Attempts → Config on compact).
- **Left column:** **Live URLs panel** (card) — labeled link rows (M3U8 / HTML / Outplayer): `mono-inline` URL truncated with `overflow-wrap`, ghost "Copy" 24px + "Open in new tab" text link `#7DB1E5`; empty `session_urls` → muted panel body 14 `#7E8798` "Live URLs unavailable — the operator must set `web_url` on the server" (no spinner, no player). **Attempts timeline** (card): one 36px row per attempt — `mono-inline` `#0` index, chip by attempt status, started→ended 12 `#7E8798`, exit code `mono-inline`, error reason `#FF6B77` 12 when failed; header shows "retry N" counter. **Config panel** (card): "Resolver config" + "Retry" fieldset legends (label-caps) over read-only JSON **mono well** (bg `bg-base`, inset `0 0 0 1px border-standard`, r4, `mono` 12, `overflow-x:auto; white-space:pre`).
- **Right column:** **Recording card** — Switch + state text; **Remux progress card** (visible only in `remuxing`) — track 6px r4 bg `fill-hover`, fill `#0C5CAB` scaled via `transform:scaleX` (origin left), percent 20/600 tabular + eta/speed 12 `#7E8798`; no frames within 10s → indeterminate track with 30% `#0C5CAB` shuttle.
**Compact order:** header → Recording → Live URLs → Remux progress → Attempts → Config (collapsed disclosure, mono well scrolls horizontally). Header ⋯ 44px → ActionSheet (Stop, Delete…).

### V5 — Autoruns list (`/autoruns`)

**Header:** filter **segmented chip row** (4 chips, 28px/44px compact horizontally scrollable): Scheduled · Live · Spent · All — active chip = `fill-active` + 1px `border-strong` + `#fafafa` label (client-side filter; grammar `?filter=` per contract); right = "New autorun" primary → D2 wizard dialog.
**Table (≥900px):** Status chip · Name (two-line cell, row stays 36px via 1.2 leading: `user_friendly_name` 14/500 over `mono-inline` 12 `#7E8798` `snake_case_name`) · Engine → Resolver · Start (relative + absolute in `title`) · End · Recording (dot) · Countdown ("starts in ~3 h 12 min", 12 tabular `#9AA3B2`, 10s tick) · Actions. **Spent rows 60% opacity**, countdown replaced by "spent" 12 `#7E8798`.
**Row actions:** Edit (dialog D2) · Run now (ghost primary-text) · Save as profile (spent) · Export (ghost) · Delete (overflow, danger-text, live warning in confirm).
**Compact:** card list (name + chip / engine→resolver / start+end+countdown lines), FAB = New autorun.

### V6 — Autorun detail (`/autoruns/$autorunId`)

Header block: StatusChip + `user_friendly_name` 20/600 + `mono-inline` slug 12 `#7E8798` + countdown 16/500 tabular + start/end (local + tz label 12 `#7E8798`) + action cluster (Edit, Run now, Save as profile, ⋯ Delete). Panels (`stack` 24): **Schedule card** (start/end `mono-inline` rows + tz helper) · **Linked live session card** (when active: V4 status line miniature — chip + `#id` + duration — plus text link "Open session" `#7DB1E5`; empty = muted "No live session yet") · **Recording flag** row · **Config card** (collapsed disclosure by default on compact, open on desktop): mono wells as V4. Edit-while-live → D2 with banner `rgba(245,158,11,.12)` "This autorun is running — only name and times can change…" and disabled config fields.

### V7 — Recordings grid (`/recordings`)

**Grid:** `repeat(auto-fill, minmax(260px, 1fr))`, gap 16 (compact: single column, gap 12) — intrinsic grid, no media queries. **Card** (bg-raised, r8, pad 16): title 14/500 `user_friendly_name` (ellipsis) · `mono-inline` 12 `#7E8798` `snake_case_name` · meta cluster 12 `#9AA3B2` engine/resolver/profile names · metrics row `mono-inline` 12 tabular: `4:12:08` · `842.3 MB` · "2 min ago" · footer action row: primary ghost "Open" (system browser) + "Copy link" ghost 24px + ⋯ overflow (Delete). **No thumbnail, no `<video>`** — `content_url` is link-only. Empty `content_url` → Open replaced by 12 `#7E8798` "Media not served on this install". `?highlight=<id>` → scroll + 2s accent ring (row-state table §4). Compact card keeps same fields, 44px buttons, one column.

### V8 — Profiles list + editor (`/profiles`)

**Table (≥900px):** Name (14/500) · Engine · Resolver · Retry mode (`mono-inline`) · Owner (admin) · Actions. Row actions: **Use** (primary ghost — opens D1 prefilled) · Edit · Export · Delete (overflow, in-use pre-scan dialog). Header right: "New profile" primary.
**Editor dialog (560px desktop / full-screen sheet with sticky Save on compact):** form `stack` gap 16 — name Input · engine Select · resolver Select · `DynamicSchemaForm` for `resolver_config` under label-caps legend "Resolver config" · retry mode Select + `DynamicSchemaForm` for `retry_config` under legend "Retry config". Footer: ghost Cancel + primary Save (loading spinner state). 400 duplicate name → inline error on name field.

### V9 — Plugins (`/plugins`)

Two sections stacked (gap 24), each = label-caps legend ("Engines", "Resolvers") + intrinsic card grid `repeat(auto-fill, minmax(280px,1fr))` gap 16. **Engine card:** name 16/600 · description 14/400 `#9AA3B2` · `mono-inline` origin_hash truncated 12 chars + 24px copy button (Copied toast) · origin URL 12 mono `#7E8798` wrap-anywhere · capability badges ("records"/"playlists" green tint vs "no record"/"no playlist" neutral) · disclosure "Retry modes": four mode names as 12/500 chips + their JSON schema in mono well. **Resolver card:** name · description · hash+copy · disclosure "Config schema" (mono well). Read-only everywhere — zero edit affordances. Footer note 12 `#7E8798`: "Plugins are discovered at server boot". Compact: single-column stacks, 44px accordions.

### V10 — Import wizard (`/import-export`)

Desktop: 720px dialog-style **panel** (centered, r8, pad 24) with step indicator top (4 steps: 1 Choose file · 2 Review · 3 Resolve · 4 Apply — active step `#7DB1E5` 12/500, done = `#10b981` ✓, upcoming `#7E8798`, connected by 1px `border-subtle` rule) and sticky footer (Cancel ghost left; Back/Next primary right). Compact: **full-screen panel 100dvh**, sticky header (Cancel + step) + sticky footer (Back/Next), no drag-drop (file-picker button only).
- **Step 1:** dropzone (desktop) = dashed `border-standard` r8 min-h 160px, body 14 `#9AA3B2` "Drop the bundle here" + "Choose file" ghost button (the keyboard-reachable path); compact = 44px file-picker button (`accept="application/json"`). Version ≠ 1 → blocking ErrorPanel "Unsupported bundle version". >500 items → hard block panel "Bundle exceeds 500 items" before validate.
- **Step 2:** per-item table (desktop) / cards (compact): name 14/500 · `mono-inline` content_hash truncated + copy · status badge — "Ready" (`--ok` style) / "Skip — already imported" (neutral) / "Needs mapping" (`--warn` style) / "Conflict" (`--danger` style).
- **Step 3 (Resolve):** one stacked row-group per issue (card per item, gap 16): `not_installed`/`hash_mismatch` → Select of installed engines/resolvers (default = `origin_hash` match, else placeholder "choose manually"); `name_conflict` → read-only preview "karl_marx_live → karl_marx_live_2" with `mono-inline` names + arrow; `profile_missing` → two-option radio stack: "Bind to existing profile" (Select) / "Use inline config" (explanatory 12 `#7E8798`); `engine_override` → radio "Keep autorun engine" / "Use profile engine"; per-item include Switch 44px (feeds `removed_*` only when excluded). Collapsed JSON preview disclosure (mono well) per item. Apply 400 → ErrorPanel at top of step 3 with server `detail`, items stay editable.
- **Step 4 (Apply summary):** centered metrics `cluster` of three `mono-inline` 20/600 counters with 12 `#9AA3B2` labels ("profiles created 12 · skipped 3 · autoruns created 7") — not three equal cards, one metrics line in a single card — plus text link "View profiles" `#7DB1E5`. Summary toast on success.

### V11 — Settings: Account (`/settings`)

Settings shell: vertical tab list at top of main (Account · Users · API clients — admin only sees all three; Tabs per §4) over a single content column max 560px. **Account tab:** user card (avatar-less: username 16/600 `mono-inline`, display name 14 `#9AA3B2`, role badge) · change-password form card (`stack`: old, new, confirm Inputs + primary "Change password"; 400 → inline on old) · notification preferences card: three 48px switch rows ("Toasts for crashes", "…completions", "…recordings saved") with 14/500 labels. Success → toast "Password changed — sign in again" → forced logout.

### V12 — Settings: Users (`/settings/users`, admin)

Table: username (`mono-inline` 14/500) · display name (`#9AA3B2`) · role badge · Actions (Delete ghost danger-text). Header right: "New user" primary → dialog (username, display name, password). Delete → typed-confirmation ConfirmDialog (type the username). Last remaining admin: delete disabled + tooltip/visible 12px "Cannot delete the last admin". Compact: card list + FAB.

### V13 — Settings: API clients (`/settings/clients`, admin)

Explainer banner first (HealthBanner geometry, neutral variant): "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications." Table: name 14/500 · created (relative + absolute title) · active (Badge: "active" green tint / "revoked" neutral) · Actions (Revoke ghost danger-text → typed confirm). Header right: "New key" primary → name dialog → **one-time reveal modal** (Dialog 560px): mono key in `bg-base` well (r4, `mono` 12, `overflow-x:auto; white-space:pre`, full width) + 24px Copy button; danger warning line 14/500 `#FF6B77` "Shown once — store it now"; primary "I've saved it" (closes; key never retrievable). Compact: full-screen sheet variant.

### D1 — New Session dialog (presentation)

560px dialog (full-screen sheet + sticky submit on compact). Structure (`stack` gap 16): **source toggle** = two-up segmented control ("From profile" / "Custom") · profile Select (from-profile mode) · engine Select · resolver Select · label-caps "Resolver config" + DynamicSchemaForm · label-caps "Retry config" with retry-mode Select + DynamicSchemaForm · Recording switch row (disabled-but-visible + "Engine cannot record" when gated) · footer: Cancel ghost + "Start session" primary (loading spinner; body all-or-nothing per dirty rule — no visual difference). 422 → inline field errors mapped via DynamicSchemaForm. No date/time fields.

### D2 — Autorun wizard dialog (presentation)

720px dialog / full-screen panel (compact). Four steps with the same step indicator as V10: **1 Identity** — `user_friendly_name` Input; `snake_case_name` Input auto-slugged on typing (slug preview `mono-inline` under the field), live regex validation `^[a-zA-Z0-9_-]+$` inline error · **2 Schedule** — start/end `datetime-local` (16px on compact) stacked, helper 12 `#7E8798` under each "Your local time — stored as UTC"; inline `#FF6B77` "End must be after start"; past start → inline `#FBBF24` "starts immediately — server treats past times as a backfill trigger" · **3 Config** — identical widget stack to D1; edit-while-live: banner `rgba(245,158,11,.12)` + disabled fields (`fill-hover` bg) · **4 Review** — single card, definition-list rows (`mono-inline` values, 12/500 `#9AA3B2` labels): names, engine→resolver, schedule with tz, recording on/off; primary "Create autorun" / "Save changes". Recording switch default **on**.

### DynamicSchemaForm (presentation)

Renders any JSON Schema object as a `stack` gap 12 of field rows (label 12/500 `#9AA3B2` left/above + control). Mapping: `string` → Input (textarea variant ≥4 rows for long strings) · `number`/`integer` → Input type=number with min/max · `boolean` → Switch row · `enum` → Select · `array` of integers → tag input (chips r4 `fill-active`, backspace removes, `mono-inline` values) · nested `object` → collapsible group (label-caps legend + `border-subtle` left indent rail 1px at 12px) · unknown extra keys → key/value editor rows (two Inputs + remove ✕). `default`/`default_params` prefill; `required` → `*` marker + `aria-required`; submit validation focuses first invalid field. Emits `{...default_params, ...values}`. Server 422 `loc` paths map to fields → Input error state. Every generated control gets `id`/`htmlFor` from the schema path.

---

## 6. Responsive rules

Chrome breakpoints (viewport `@media`) are **640px** and **900px**; component-internal adaptation uses `container-type: inline-size` + `@container` (e.g. recording cards in a narrow rail column), per layout-skill. Named states, never device names.

| Viewport | Chrome | Lists | Page pad / gap | Dialogs | Type deltas |
|---|---|---|---|---|---|
| ≥1280 | 224px sidebar + 48px topbar | table, **all columns** (incl. Profile + Owner for admin) | 24 / 24 | centered 560px (wizards 720px) | base 14 |
| 900–1279 | 224px sidebar + 48px topbar | table, **column priority:** drop Profile + Owner; keep Status · ID · Engine→Resolver · Started/Dates · Recording · Duration · Actions. Truncate name cells (`ellipsis` + `title`) | 24 / 24 | centered 560px | base 14 |
| 640–899 (`--bp-rail`) | **56px icon rail** + 48px topbar | **card list** (table needs ≥900) | 16 / 16 | centered 480–560px, max `calc(100% − 32px)` | base 14 |
| 375–639 (`--bp-compact`) | 44px app bar + 56px tab bar + 56px FAB | card list, card anatomy per V3 | 16 / 16 | bottom sheets (r8 top); wizards full-screen | base 14; **inputs 16px**; titles 16/600; tab labels 11/500 |
| ≤375 | same compact chrome | same | 16 | same | same; metric clusters wrap to 2 lines; mono wells scroll internally |

**Breakpoint mechanics:**
- 640px: sidebar 224→56 (labels swap to `aria-label` + tooltip), tables→card lists, dialogs widen to `calc(100% − 32px)`.
- 900px: sidebar 56→224 (labels return), card lists→tables (column priority per width band above).
- V4 two-column body flips at **1100px** (`list-detail` → `stack`, order: Recording → Live URLs → Remux progress → Attempts → Config).
- Recordings/Plugins grids are intrinsic (`auto-fill minmax(260px|280px, 1fr)`) — no query needed; `min(…, 100%)` floor prevents 375px overflow.
- 375px hard rule: **no horizontal scrollbar** anywhere except mono wells + filter chip rows (internal `overflow-x:auto`). Shell carries `overflow-x: hidden`.
- Compact touch floor 44×44 for every target (desktop 32 with 24px table-overflow exception — that exception does not exist on compact). ≥8px between adjacent targets.
- Hover-only facts (tooltips) always have a compact-visible twin as 12px `#7E8798` text (e.g. "Engine cannot record", countdowns, error reasons).
- Safe areas: app bar `env(safe-area-inset-top)`, tab bar/FAB/content-bottom `env(safe-area-inset-bottom)`, landscape adds left/right insets to page padding.

---

## 7. Accessibility (WCAG 2.2 AA floor, against §1 tokens)

**Contrast** (WCAG 2.x relative luminance, computed against the exact §1 hexes; body ≥4.5:1, large ≥3:1, graphics ≥3:1):

| Pair | Ratio | Verdict |
|---|---|---|
| `#fafafa` on `#09090b` (body/headings) | 19.1:1 | AAA |
| `#fafafa` on `#14171B` (card/table text) | 17.2:1 | AAA |
| `#9AA3B2` on `#09090b` (secondary) | 7.8:1 | AAA body-safe |
| `#9AA3B2` on `#14171B` | 7.1:1 | AAA body-safe |
| `#7E8798` on `#14171B` (muted meta only) | 5.0:1 | AA (meta only, never body) |
| `#7DB1E5` on `#09090b` (links/focus) | 8.8:1 | AAA |
| `#7DB1E5` on `#14171B` | 8.0:1 | AAA |
| `#fafafa` on `#0C5CAB` (primary button) | 6.4:1 | AA |
| `#fafafa` on `#0a4a8a` (button hover/secondary) | 8.5:1 | AAA |
| `#09090b` on `#ef4444` (danger button/badge text) | 5.5:1 | AA |
| `#FF6B77` on `#09090b` (error text) | 7.2:1 | AAA |
| `#7DB1E5` on scheduled chip tint | 7.4:1 | AAA |
| `#34D399` on active/completed chip tint | 7.9:1 | AAA |
| `#FBBF24` on terminating chip tint | 8.8:1 | AAA |
| `#FF6B77` on recording/failed chip tint | 5.9:1 | AA |
| `#A7C0E0` on remuxing/finalizing chip tint | 9.1:1 | AAA |
| `#9AA3B2` on unknown chip tint | 6.6:1 | AAA |
| `#7E8798` on `#09090b` (muted on base) | 5.5:1 | AA |
| `#ef4444` / `#10b981` / `#f59e0b` dots on base (graphics) | 5.5 / 7.8 / 12.0:1 | ≥3:1 AA graphics |
| `#0C5CAB` 2px focus ring vs base | 3.0:1 | meets 3:1 non-text |

Implementer re-runs `scripts/check-contrast` (mechanism kept from the architecture brief) at scaffold time against these exact tokens; any future token change must re-land these floors.

**Focus:** 2px `#7DB1E5` outline, offset 1px, on every interactive element (`:focus-visible`); never `outline:none` without the ring replacement. Focus order = DOM order; dialogs/drawers/sheets trap focus and return it to the opener on close; Esc closes dialogs/drawers/menus/sheets.

**Keyboard:** all actions Tab-reachable; row actions via focusable overflow button; Enter submits forms; no drag-only interactions (dropzone always has a file-picker button); select/listbox/menu arrow-key patterns per §4.

**Live regions:** toasts `role="status"` (errors `role="alert"`); StatusChip on detail headers `aria-live="polite"`; unread badge `aria-label="N unread notifications"`; WS connection dot `role="status"` with text label (tooltip on desktop, always-visible on compact) — never color-alone.

**Status never color-only:** every StatusChip pairs dot + text label; ✓/✕ icons supplement `completed`/`failed`; the recording pulse supplements the label, never replaces it.

**Forms:** every input paired `<label>`; DynamicSchemaForm generates `id`/`htmlFor` from schema path; inline errors `aria-describedby`; required fields visually marked + `aria-required`; 16px input text on compact (kills WebView focus zoom).

**Names/roles:** nav = `<nav aria-label="Primary">`; tables real `<table>` + `<th scope="col">`; bell = `<button aria-haspopup="dialog">`; `aria-current="page"` on active tab; `aria-disabled` (not just disabled attr) on disabled-but-visible controls.

**Hit areas:** ≥32×32px desktop (dense exception: 24px table overflow buttons); ≥44×44px on compact with no exceptions; icon-only controls always `aria-label` + tooltip.

**Reduced motion:** `prefers-reduced-motion` → recording pulse off (static dot), spinners become static hourglass icons, all transitions 0ms, skeleton shimmer static, progress bar snaps; opacity-only ≤150ms survives (state communication). Root `<MotionConfig reducedMotion="user">` mandatory.

**RTL:** not supported v1 (Latin-only install) — noted so nobody half-mirrors the shell.

---

## 8. Motion (motion.dev tokens — only where motion has a job)

Package `motion` v13 (`import { motion } from "motion/react"` — never `framer-motion`). Root: `<MotionConfig reducedMotion="user">`. Four named tokens are law (`micro` 400/30 spring · `ui` 300/24 spring · `page` 350/35 spring · `tween-enter` 0.2s easeOut). Never mix physics and duration keys in one transition.

| Job | Where | Token / mechanism | Why it earns motion |
|---|---|---|---|
| **Live-ness signal** | `recording` chip/row dot pulse | CSS keyframes opacity .55→1, **1.6s** ease-in-out infinite | The one continuous motion: a running recorder must be visible at a glance across a dense table. Disabled under reduced motion (label carries meaning). |
| **Work-in-progress signal** | `remuxing`/`finalizing` chip spinner; button/switch pending spinners | CSS rotate 0.9s linear (spinner); static hourglass under reduced motion | Indeterminate async work needs a heartbeat or it reads as a frozen UI. |
| **Press feedback** | primary/ghost/danger buttons, FAB, Tab, nav items | `whileTap={{scale: .97}}` (FAB .95), `transition=**micro** | Tactile registration on commit-heavy controls in a dense console. |
| **Component state change** | overflow menu / select popover / drawer open-close | `transition=**ui**` — menu: opacity 0→1 + scale .98→1 origin top; drawer: x 100%→0 (desktop right), slide (compact sheet y) | Spatial continuity for layers that appear over live data. |
| **Overlay enter/exit** | Dialog, ConfirmDialog, sheets, toasts | `tween-enter` (0.2s easeOut): opacity 0→1 + y 8→0 on enter; exit opacity 1→0 (0.15s easeIn); `AnimatePresence mode="wait"` per overlay | Overlays must announce arrival without stealing a frame budget from the table. |
| **Progress continuity** | remux progress bar fill | `transform:scaleX` 0.2s easeOut per frame batch (origin left) | Percent jumps of 5–15% snap harshly without smoothing. |

**`page` token is pinned but UNUSED in v1** — no route transitions, no shared-element `layoutId` morphs (operator console: instant route swaps; layout projection costs and resize-blocking are not justified by a job here). Re-pin `page` only if a future morph gets a named job.

**Explicitly banned (motion as filler):** scroll-reveal/`whileInView` fade-ups, list enter staggers, hover lift/scale on cards, parallax, marquees, animated gradients, page-transition crossfades. Rows update in place via cache patches — the data changing *is* the feedback.

**Perf rails:** animate transform/opacity only (progress via `scaleX`, never `width`); no `will-change` permanence; spinner/pulse are CSS keyframes (not motion/react) to keep them out of React renders; `LazyMotion` + `m` if any `motion.*` tree ships.

---

## 9. Realistic content (sample data — contracts for empty/error copy)

**Session rows (V3 sample):**

| Status | ID | Engine → Resolver | Profile | Rec | Started | Duration |
|---|---|---|---|---|---|---|
| ● Recording | `#5` | `yt_dlp` → `twitch_gql` | `twitch-1080p60` | ● on | 2 min ago | `0:02:14` |
| ● Running | `#4` | `streamlink` → `generic_hls` | — | ○ off | 18 min ago | `0:18:02` |
| ● Remuxing | `#3` | `yt_dlp` → `direct_url` | `archive-mp4` | ● on | 1 h ago | `1:04:37` |
| ✓ Completed | `#2` | `yt_dlp` → `generic_hls` | `karl-teardown` | ● on | yesterday | `2:11:09` |
| ✕ Failed | `#1` | `ffmpeg_native` → `direct_url` | — | ○ off | yesterday | `0:00:06` |

**Autorun rows (V5 sample):** "Weekly firmware teardown" (`weekly_firmware_teardown`, scheduled, "starts in ~3 h 12 min") · "karl — friday karaoke" (`karl_friday_karaoke`, recording, started 12 min ago) · "LCSP mirror backup" (`lcsp_mirror_backup`, spent/failed, "spent") · "sdg-300c unboxing restream" (`sdg_300c_unboxing`, scheduled, "starts tomorrow 20:00").

**Recording cards (V7 sample):** "Weekly firmware teardown — ep 41" `weekly_firmware_teardown_ep41` · `yt_dlp / generic_hls / archive-mp4` · `2:11:09` · `1.8 GB` · "2 days ago" · Open / Copy link. Another: "karl — friday karaoke" `karl_friday_karaoke` · `4:03:55` · `842.3 MB` · "6 h ago".

**Empty/error copy (verbatim):**
- V3 empty: "No sessions yet — start your first recording" (primary "New session")
- V5 empty: "No autoruns — schedule a recording" (primary "New autorun")
- V7 empty: "No recordings yet — enable recording on a session"
- V8 empty: "No profiles — save a reusable configuration"
- V9 empty: "No engines installed" / "No resolvers installed"
- V12 empty: "No users"
- V13 empty: "No API clients yet — create one for programmatic access"
- V4 live-URL empty: "Live URLs unavailable — the operator must set `web_url` on the server"
- V7 media-unavailable: "Media not served on this install"
- Probe failure toast: "Media not reachable — file may not be served"
- Control failure banner: "Control unavailable — session may be stuck" (+ "Force delete")
- Session expiry toast: "Session expired" · 429: "Too many attempts — try again shortly" · delete 409: "Cannot delete while remuxing" · change-password success: "Password changed — sign in again"
- WS exhausted banner: "Live updates offline — polling every 15s" (+ "Retry") · health: "API unreachable — retrying"
- API-client banner: "Acting as API client 'ci-bot' — created resources belong to no user and produce no notifications"
- Stop confirm: "Stop session #5? The recording will finalize."
- Live autorun delete confirm warning: "A recording is running — deleting will stop and delete it"
- One-time key reveal: "Shown once — store it now" (primary "I've saved it")
- Profile in-use confirm: "In use by 2 autoruns / 1 session"
- Toaster samples: "Autorun 'karl teardown' started" · "Session #5 completed" · "Recording saved" (action "Open") · "Session #5 failed"

**Machine-value rendering (the type axis in content):** IDs `#5` · hashes `a3f19c02b7d4` (12-char truncate + copy) · snake_case slugs `weekly_firmware_teardown` · durations `2:11:09` / `4:12` · sizes `842.3 MB` (1 decimal, binary units) · JSON wells `{"retry_mode": "exponential", "max_attempts": 5}` — all `mono-inline` with `font-variant-numeric: tabular-nums`; every count, countdown, and duration uses tabular figures so dense columns align optically.

---

## 10. Assumptions resolved + Design Direction application

**Axis discipline check:** pushed = **Type (type + density hierarchy)**, exactly one. Quieted: colour (one accent hue + fixed semantic status), layout (standard shells from layout-skill), motion (six named jobs only). Accessory removed: content-surface drop shadows (depth = luminance steps + hairlines). No anti-slop never is present: no violet-indigo gradient or `blue-600`; IBM Plex Sans display (Inter/Roboto/DM Sans absent); no three-equal-cards primary pattern (grids are intrinsic and mixed-width, V10 summary is one metrics line); radii 4/8/full scale with element; no blurred `.1` default shadow (overlays only); no emoji icons (inline SVG stroke icons 1.5–2px, `currentColor`); no gradient text; no repeated caps eyebrows (label-caps limited to `<th>` + fieldset legends); no scroll fade-ups; no hover-lift cards; no acid-green, no cream+serif, no broadsheet costume.

**Assumptions resolved on the implementer's behalf:**
1. **Type axis choice** (payload offered "type + density" OR "status color"): chose type + density — status semantics are contract-fixed wire facts (they cannot be restyled into a signature without breaking the STATUS_MAP rules), while density is free to carry identity. Kraken spice is therefore confined to chip tint/contrast craft, exactly as the application rules demand.
2. **`--purple` → `secondary` `#0a4a8a`** with `#A7C0E0` labels: no purple may ship (anti-slop + Kraken-purple-refused); `remuxing`/`finalizing` disambiguate from `scheduled` by spinner + label, never hue alone. Consequence: two statuses share the deep-blue family — accepted and covered by the "status never color-only" rule.
3. **`#7DB1E5` accent-text variant** is derived contrast laddering of the enterprise primary (fills stay `#0C5CAB`/`#0a4a8a` exactly as conditioned), because raw `#0C5CAB` text on `#09090b` is 3.0:1 and fails body contrast; the focus ring and links use the text variant.
4. **13px base re-bound to 14px** (enterprise sourceScale 12/14/16/20/24/32 has no 13); density preserved via 36px rows + 12px meta.
5. **6px dialog radius re-bound to 8px** (`rounded.md`) per enterprise radii; bottom sheet keeps `8px 8px 0 0`.
6. **IBM Plex Mono pinned** for machine values (pairs with Plex Sans — one superfamily, one voice); JetBrains Mono unnecessary here.
7. **Emphasis weight = 500** (Plex Medium plays Linear's 510 signature role; Plex has no 510). Weights used: 400/500/600 only.
8. **Danger-filled buttons/badges use `#09090b` text** (white on `#ef4444` is 3.5:1 — fails); this doubles as the "warning tape" read on destructive confirms.
9. **Calendar lib (autoruns)** — out of visual scope here; when chosen, its cells consume these tokens (row 36px, r4, chip reuse). No FullCalendar skin in this spec.
10. **Icon set:** inline SVG stroke icons only (1.5–2px stroke, 16px desktop / 20–22px compact), `currentColor`, no icon font, no emoji.
11. **Contrast ratios** computed with the WCAG 2.x relative-luminance formula against §1 hexes (rounded to 0.1:1). They are decision values; the scaffold's `check-contrast` script re-verifies mechanically.
12. **No codebase claims in this document.** UI is greenfield (`mirrorr-web/` does not exist; legacy UIs are rejected and were not consulted). All behavior facts come from the task payload's functional contract (which cites the client spec + `mirrorr-core` verification). Any later divergence from `docs/general-client-specification.md` resolves toward the client spec, not this document.

**Design Direction application map:** enterprise tokens → §1 YAML (every hex/size/radius/space traces to it; derived neutrals documented as luminance steps over `#09090b`) · layout-skill → §3 scroll ownership (`min-block-size: 0`, `100dvh`, one scroll container per region, named primitives `fixed-sidenav-shell`/`list-detail`/`stack`/`cluster`/`scroll-body-shell`, content-stress §3.4, container queries §6) · linear reasoning → luminance-stacked surfaces, hairline white borders as depth, shadow ban on content, 500-weight signature, accent reserved for interactive · kraken spice → chip/badge tinted fills + contrast-verified label text (§2, §4 chip/badge matrices) · anti-slop → prohibitions listed above, all clear · motion fixture → §8 four pinned tokens, `reducedMotion="user"`, jobs-only table, `page` reserved-unused.

**Definition of done (visual):** every state in §4 reachable in `/visual-qa`; §7 ratios hold mechanically; 375/768/1280 screenshots show one coherent console — dense, Plex, flat, blue-only accent — with zero prohibited-default hits from `design-gate`.

