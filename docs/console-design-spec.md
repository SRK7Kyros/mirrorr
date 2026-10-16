# Mirrorr Console — Design Specification (Two Variants, One Token System)

Status: decision-complete. No open questions. Every judgement is recorded in §11.
Tokens are law; prose is context. Values override moods.

---

## 0. Design Read

One line: A light, cold-daylight **glass control deck** for a live-stream recorder —
frosted acrylic chrome floating over the product's own stream media, with every
reading surface opaque, so an operator watches machines make bytes through a
window of etched glass.

**Pushed axis (exactly one): LAYOUT.** The boldness is spent entirely on shell
anatomy and depth choreography — which regions exist, who scrolls, where acrylic
sits, how the backdrop is staged. Type stays quiet (three token roles + one
interpolation rule). Colour stays quiet (token hues, functional only). Motion
stays quiet (four pinned tokens + one parallax). Nothing else is pushed.

Fidelity anchors for a reviewer: `DESIGN.glassmorphism.md` token law (§1) is
normative; hard laws 1–10 of the brief are implemented literally (blur ladder
8/16/24/40 by z-height, alpha 0.55/0.64/0.72, luminous edge, real backdrop,
no body text on acrylic, radius 0/4/8 closed, status colour never text, four
motion tokens, scrim-bought contrast, no three-equal-cards, no mixed elevation).

---

## 1. Token block

### 1.1 Token YAML (DESIGN.md schema, resolved)

```yaml
version: alpha
name: Glassmorphism
description: >-
  Light frosted-acrylic console system. White haze 55-72% alpha, blue-tinted
  depth, luminous 1px edges, blur scales with z-height. WCAG 2.2 AA bought with
  scrims, never by dulling the glass.
colors:
  primary: "#1856FF"
  secondary: "#3A344E"
  success: "#07CA6B"
  warning: "#E89558"
  danger: "#EA2143"
  surface: "#FFFFFF"
  text: "#141414"
derived:            # resolution extensions — see 1.2 rationale per value
  text-muted: "#6E6E6E"        # helper/placeholder, opaque grounds only, 5.10:1 on surface
  success-deep: "#05A257"      # indicator fills on light grounds, 3.33:1 on surface
  warning-deep: "#C9722F"      # indicator fills on light grounds, 3.54:1 on surface
  danger-deep: "#D01431"       # text-bearing destructive fill, 5.49:1 with white label
typography:
  h1:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label-caps:
    fontFamily: "JetBrains Mono"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "64px"
  gutter: "24px"
  measure: "68ch"
glass:
  surface: "rgba(255, 255, 255, 0.64)"
  border: "rgba(255, 255, 255, 0.28)"
  blur-chip: "8px"
  blur-card: "16px"
  blur-modal: "24px"
  blur-nav: "40px"
  shadow: "0 24px 48px -12px rgba(24, 86, 255, 0.18), 0 8px 16px -8px rgba(20, 20, 20, 0.12)"
  tint: "rgba(24, 86, 255, 0.08)"
components:
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.surface}", typography: "{typography.body-md}", rounded: "{rounded.sm}", padding: "12px 20px" }
  button-secondary: { backgroundColor: "rgba(255,255,255,0.64)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.sm}", padding: "11px 19px" }
  card: { backgroundColor: "rgba(255,255,255,0.64)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.md}", padding: "{spacing.md}" }
  chip: { backgroundColor: "rgba(255,255,255,0.55)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.sm}", padding: "8px 12px" }
  input: { backgroundColor: "rgba(255,255,255,0.72)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.sm}", padding: "12px 14px" }
  link: { backgroundColor: "omitted", textColor: "{colors.primary}", typography: "{typography.body-md}", rounded: "{rounded.none}", padding: "0px" }
  nav: { backgroundColor: "rgba(255,255,255,0.55)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.md}", padding: "12px 16px" }
  modal: { backgroundColor: "rgba(255,255,255,0.72)", textColor: "{colors.text}", typography: "{typography.body-md}", rounded: "{rounded.md}", padding: "{spacing.lg}" }
motion:
  micro:       { type: "spring", stiffness: 400, damping: 30 }
  ui:          { type: "spring", stiffness: 300, damping: 24 }
  page:        { type: "spring", stiffness: 350, damping: 35 }
  tween-enter: { duration: 0.2, ease: "easeOut" }
```

### 1.2 CSS custom properties (normative implementation values)

```css
:root {
  /* ---- colour: system hues ---- */
  --color-primary: #1856FF;
  --color-secondary: #3A344E;
  --color-success: #07CA6B;
  --color-warning: #E89558;
  --color-danger: #EA2143;
  --color-surface: #FFFFFF;
  --color-text: #141414;

  /* ---- colour: derived (why: hard law 7 demands colour placements at >=3:1,
         and #07CA6B measures 2.17:1 / #E89558 2.37:1 on surface — both fail.
         Deep variants keep the hue family and clear the floor.
         #D01431 exists because #EA2143 carries white labels at only 4.38:1,
         which fails 4.5:1 for 16px text; see 8.2 table) ---- */
  --color-text-muted: #6E6E6E;
  --color-success-deep: #05A257;
  --color-warning-deep: #C9722F;
  --color-danger-deep: #D01431;

  /* ---- colour: glass mix + edges ---- */
  --glass-chip: rgba(255, 255, 255, 0.55);      /* chips + nav */
  --glass-card: rgba(255, 255, 255, 0.64);      /* acrylic cards */
  --glass-modal: rgba(255, 255, 255, 0.72);     /* modals, drawers, inputs, toasts */
  --glass-nav: rgba(255, 255, 255, 0.55);       /* nav tier */
  --glass-tint: rgba(24, 86, 255, 0.08);        /* colors.primary @ 0.08 over acrylic */
  --glass-border: rgba(255, 255, 255, 0.28);    /* 22-35% white band midpoint */
  --edge-near: rgba(255, 255, 255, 0.35);       /* inset top-left highlight */
  --edge-far: rgba(20, 20, 20, 0.06);           /* inset far-edge weight */
  --glass-shadow: 0 24px 48px -12px rgba(24, 86, 255, 0.18),
                  0 8px 16px -8px rgba(20, 20, 20, 0.12); /* blue-tinted, never grey */

  /* ---- blur ladder (z-height; two adjacent acrylics never share a step) ---- */
  --blur-chip: 8px;
  --blur-card: 16px;
  --blur-modal: 24px;
  --blur-nav: 40px;

  /* ---- scrim ladder (under text runs over media; always rgba(20,20,20,a)) ---- */
  --scrim-45: rgba(20, 20, 20, 0.45);
  --scrim-55: rgba(20, 20, 20, 0.55);
  --scrim-65: rgba(20, 20, 20, 0.65);
  --scrim-75: rgba(20, 20, 20, 0.75);

  /* ---- type ---- */
  --font-sans: "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --text-h1: 3rem;                 /* 48px / 700 / 1.1 / -0.02em */
  --text-h2: clamp(1.5rem, 1.25rem + 1vw, 2rem);      /* interpolation, not a token */
  --text-h3: clamp(1.125rem, 1.0625rem + 0.3vw, 1.5rem);
  --text-body: 1rem;               /* 16px / 400 / 1.5 */
  --text-label: 0.75rem;           /* 12px mono / 500 / 1.4 / 0.08em — opaque chrome only */
  --tracking-h1: -0.02em;
  --tracking-label: 0.08em;
  --weight-read: 400;
  --weight-ui: 500;
  --weight-announce: 700;
  --measure: 68ch;

  /* ---- radius (closed 0/4/8; outer = inner + shared padding) ---- */
  --radius-none: 0px;   /* text links */
  --radius-sm: 4px;     /* buttons, chips, inputs */
  --radius-md: 8px;     /* cards, modals, floating nav, panels */

  /* ---- spacing (4-point grid; nothing off-scale) ---- */
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 32px;
  --space-xl: 64px;
  --gutter: 24px;

  /* ---- luminous edge recipe (top-left light source, always) ---- */
  --luminous-edge:
    inset 1px 1px 0 var(--edge-near),
    inset 0 -1px 0 var(--edge-far);
  /* full surface: box-shadow: var(--luminous-edge), var(--glass-shadow);
     plus 1px var(--glass-border) carried in the shadow layer
     (0 0 0 1px var(--glass-border)) so radii never clip it */

  /* ---- focus (two-layer ring; see 8.3 for the measured reason) ---- */
  --focus-ring:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-primary),
    0 0 0 5px var(--color-text);

  /* ---- motion (four pinned tokens — never re-invent numbers) ---- */
  --motion-micro: spring(400 / 30);        /* { type:"spring", stiffness:400, damping:30 } */
  --motion-ui: spring(300 / 24);           /* { type:"spring", stiffness:300, damping:24 } */
  --motion-page: spring(350 / 35);         /* { type:"spring", stiffness:350, damping:35 } */
  --motion-tween-enter: 0.2s ease-out;     /* { duration:0.2, ease:"easeOut" } */
}
```

Rationale for the derived hues (they are resolutions, not new law): hard law 7
requires every colour placement at ≥3:1, but `success` 2.17:1 and `warning`
2.37:1 on `surface` cannot carry an indicator. The `-deep` variants are the same
hues darkened just past the floor (measured in 8.2). `text-muted` exists because
placeholder text must itself pass 4.5:1 (taste-skill form contrast check).
`danger-deep` exists so the destructive button can carry a white 16px label.

### 1.3 The acrylic + opaque recipes (paired)

Every glass component has an **opaque twin**. Which one is used is decided by the
ground beneath it — never by taste:

```css
/* acrylic variant — only where backdrop media is visible behind the surface */
.acrylic {
  background: var(--glass-<tier>);            /* 0.55 | 0.64 | 0.72 by class */
  backdrop-filter: blur(var(--blur-<step>)) saturate(1.2);
  background-image: linear-gradient(var(--glass-tint), var(--glass-tint));
  box-shadow: 0 0 0 1px var(--glass-border), var(--luminous-edge), var(--glass-shadow);
  border-radius: var(--radius-<sm|md>);
}
/* opaque twin — inside opaque panels, or when the operator disables backdrop */
.opaque {
  background: var(--color-surface);
  box-shadow: 0 0 0 1px var(--glass-border), var(--luminous-edge), var(--glass-shadow);
  border-radius: var(--radius-<sm|md>);
}
/* dark-chrome variant — solid secondary toolbars/spines/table headers */
.chrome-dark {
  background: var(--color-secondary);
  color: var(--color-surface);
  box-shadow: var(--luminous-edge);
}
```

Acrylic tier map: chips + nav `0.55`; cards `0.64`; modals, drawers, inputs,
toasts `0.72`. Blur map: chips `8px`; cards + inputs `16px`; modals + drawers
`24px`; nav + toasts `40px` (topmost surface gets the widest blur). The acrylic
input (16px) appears only in modals (24) or on bare media — never inside an
acrylic card (16) or an opaque panel, where it uses the opaque twin. This is how
"two adjacent acrylic surfaces never share a blur step" is kept while honouring
the input recipe.

### 1.4 State → token binding table (session lifecycle)

Icon + word doubling is mandatory on every status. Icons are stroke icons
(1.75px stroke, 20px box on acrylic / 16px in opaque chips); emoji are banned.
Words always render in `--color-text` (18.42:1 on surface). Indicator colours are
the `-deep` set where the base hue fails 3:1 on surface. Tone keys match
`StatusTone`, dot behaviour matches `StatusDot` in the existing spine
(`src/lib/status-map.ts`) so the table drops into `STATUS_MAP` unchanged.

| Status key | Word | Tone | Indicator hue (shape) | Dot | Icon (shape) | Actions (API 12.2) |
|---|---|---|---|---|---|---|
| `scheduled` | Scheduled | primary | `#1856FF` 3px left bar + dot (5.51:1) | static | clock — circle, two hands | edit, delete, run-now |
| `initializing` | Initializing… | secondary | `#3A344E` dot (11.79:1) | spinner | loader — circular arc | stop |
| `stream_pending` | Waiting for stream… | secondary | `#3A344E` dot (11.79:1) | spinner | hourglass — two triangles | stop |
| `active` | Running | success | `#05A257` dot + bar (3.33:1) | static | play — triangle in circle | stop, enable/disable recording |
| `recording` | Recording | danger | `#EA2143` filled record dot (4.38:1) | pulse | record — filled disc in ring | stop, disable recording |
| `terminating` | Stopping… | warning | `#C9722F` dot (3.54:1) | spinner | stop — square in circle | wait, delete |
| `remuxing` | Remuxing | secondary | `#3A344E` dot (11.79:1) | spinner | remux — two arrows, box | wait — **delete disabled** |
| `finalizing` | Finalizing | secondary | `#3A344E` dot (11.79:1) | spinner | package — sealed box | wait |
| `completed` | Completed | success | `#05A257` check-in-circle (3.33:1) | static | check — circle, tick | save-as-profile, delete |
| `failed` | Failed | danger | `#EA2143` x-in-octagon (4.38:1) | static | x — octagon, cross | save-as-profile, delete |
| `unknown` | Unknown | neutral | `#141414` hollow ring (18.42:1) | static | help — circle, question | delete |

Binding rules: `recording` is the only pulsing status (reduced motion → static
dot, see 9.3); `remuxing`/`finalizing` bind the spinner dot and a determinate
remux progress bar when `session.{id}.remux.progress` is flowing (13.4). The
API's "purple" for remuxing/finalizing resolves to `secondary` `#3A344E` — the
system's dark chrome hue, which is itself purple-leaning; token law outranks the
reference palettes (resolved tension 3). `unknown` is the client fallback for an
unrecognized status string (API 12.2: render "unknown" + log) and is styled with
no hue at all so a new server status can never be misread as a known one.
`active` is included although the brief's shorthand lifecycle omits it: Part 3
§4 and §12.2 both define it ("Running", green), and inventing fewer statuses than
the API sends is a defect. `initializing`/`stream_pending` (added Oct 2026) are the
two-stage startup gate (API §13.2.1): both bind the spinner dot like
`remuxing`/`finalizing`, carry **stop** only, and expose no recording toggle until
the row reaches `active`.

## 2. Glass placement rule

The law: glass owns chrome and overlays; dense reading surfaces are opaque.
Glass on flat white is a BUG — an acrylic surface exists only where backdrop
media (or the licensed mesh) is visible behind it. Exact placement:

| Region / component | Material | Alpha | Blur | Why |
|---|---|---|---|---|
| Nav rail (A) / command capsule (B) | acrylic | 0.55 (`--glass-nav`) | 40px | Top of the depth stack; widest blur |
| Modals, confirm dialogs, drawers | acrylic | 0.72 | 24px | Overlays over a darkened scrim; densest haze before inputs |
| Toasts | acrylic | 0.72 | 40px | Topmost surface when present; placed to never touch nav (see 1.3); over a modal they differ (40 vs 24) |
| Acrylic cards (instrument plates: countdown, tally) | acrylic | 0.64 | 16px | Short label-level content only (≥14px); sit on bare media, never inside panels |
| Filter/action chips on media grounds | acrylic | 0.55 | 8px | Small, low z |
| Acrylic inputs (search in capsule/modal only) | acrylic | 0.72 | 16px | Densest haze because reading comes first; never adjacent to a 16px acrylic card (opaque twin inside panels) |
| Wall tiles' status chips (B) | acrylic | 0.55 | 8px | Over live stills |
| **All lists, tables, forms, detail panes, wizards** | **opaque `surface` #FFFFFF** | — | none | Reading text never on acrylic (tension 1) |
| Topbar (A), spine (B), table header bars | opaque `secondary` #3A344E | — | none | Dark chrome; the licensed home of `label-caps` 12px |
| Chips/inputs inside opaque panels | opaque twin | — | none | Acrylic inside an opaque panel is glass on flat white |
| Panels when no media exists at all | opaque + "no backdrop" note | — | none | "Drop to opaque and admit it" — never frost over nothing |

Blur-ladder adjacency audit (hard law 1): within any one column the visible
acrylics are nav 40 / modal 24 / card 16 / chip 8 — no two adjacent surfaces
share a step. Toasts (40) are pinned bottom-right in A and bottom-left-of-stage
in B, never overlapping the nav tier (40).

**Backdrop layer** (z0, fixed, behind everything):
1. **Scrim** — `--color-secondary` at 55% over the page ground (`#FFFFFF`),
   filling the full viewport so parallax travel never flashes the page ground
   at the edges. Steps to 65–75% under any text run that sits on media.
2. **Media** — the product's own subject, in this order:
   1. live session stills — first-frame/poster from `session_urls` M3U8 entries
      (only when `web_url` is configured; empty `session_urls` is a normal state,
      not a bug — API 13.10.6),
   2. recording poster frames from `content_url` (progressive, link-only — API
      13.11.5),
   3. **empty-database default: licensed gradient mesh** with four distinct hue
      fields (no purple/indigo), specified exactly:
      ```css
      background-color: #233038;
      background-image:
        radial-gradient(120% 90% at 12% 18%, #7FB2C8 0%, transparent 55%),   /* glacier */
        radial-gradient(110% 85% at 88% 12%, #E8B48A 0%, transparent 50%),   /* apricot */
        radial-gradient(130% 100% at 72% 88%, #0E3B43 0%, transparent 62%),  /* deep teal */
        radial-gradient(90% 80% at 22% 92%, #5C7A5E 0%, transparent 55%);    /* moss */
      ```
3. **Parallax carrier** — the media layer translates `y: -40px → 40px`
   (`useScroll` + `useTransform`, `clamp: false`); acrylic chrome drifts at
   0.25× of that travel. The one licensed parallax lives between backdrop and
   acrylic only (§9).

Where the operator pins nothing and the DB is empty, the mesh is the media and
glass is legal over it. If the backdrop is disabled entirely, every acrylic
surface swaps to its opaque twin (§1.3) and the shell shows a `label-caps`
note "backdrop off — opaque surfaces".

---

## 3. Variant A — "Safe"

Conventional navigation vocabulary, read confidently: a floating glass rail over
a controlled ground. Anatomy (named regions, desktop ≥1280px):

| Region | Position / size | Material | z | Scroll owner |
|---|---|---|---|---|
| `backdrop` | fixed, full viewport | scrim + media + parallax | 0 | **none** — transform-only travel |
| `nav-rail` | fixed left, 240px wide, 16px inset from edges (floating slab) | acrylic 0.55 / blur 40, radius 8, luminous edge | 40 | **nav-rail** owns its own vertical scroll (only overflows on short viewports) |
| `topbar` | fixed top of main column, 56px high | opaque `secondary` chrome, white text | 30 | **none** — fixed height, content never scrolls |
| `stage` | main column right of rail, 24px page margin | ground is raw media; content in opaque `surface` panels (radius 8, luminous edge) with 16px gaps between panels | 10 | **stage** — THE vertical scroll owner of the view |
| `tally-band` | first row of stage, over a media gap | asymmetric acrylic cards 0.64 / blur 16 (different spans, never three equal) | 10 | none (fixed three plates) |
| `overlay-layer` | viewport-centered / right drawer / bottom-right toast | scrim + modal/drawer 0.72/24 + toast 0.72/40 | 50–70 | **dialog body** / **drawer body** own their own scroll when content overflows (named, per overlay) |
| `table-wrap` (inside stage) | inside panels | opaque | — | **table-wrap** owns horizontal scroll when a table exceeds 8 columns (named job #2) |

z-stack bottom→top: backdrop 0 → stage panels 10 → topbar 30 → nav-rail 40 →
overlay scrim 50 → modal/drawer 60 → toast 70.

Where glass sits in A: nav-rail, tally-band cards, chips over media gaps, all
overlays. Everything that carries reading text is opaque.

Nav-rail contents (top→bottom): wordmark plate ("MIRRORR" in `label-caps` on an
opaque mini-plate + subtitle "recorder console"); nav items — Sessions,
Autoruns, Recordings, Profiles, Plugins, Import/Export, Settings; footer block —
WS connection chip (Live / Polling 10s / Offline), `API_CLIENT_POLL_LABEL`
("API client — polling every 10s") when `isApiClientPrincipal()`, and the user
chip (display_name + role).

Topbar contents: breadcrumb + view title (16px white on chrome), the view's ONE
primary button (e.g. "New session"), bell + unread badge, user menu (Account,
Change password, Sign out).

**Navigation model:** one route per surface (routes already wired: sessions,
sessions-detail, autoruns, autoruns-detail, recordings, profiles, plugins,
import-export, settings, login, register, not-found; `index-route` renders the
Sessions list — decision 11.1). List→detail is a route change (`page` token
shared-element on the row title). "Use profile" on a profile row navigates to
the session form prefilled. Notification click navigates to
`resource_type/:id`. Esc closes the topmost overlay; focus returns to trigger.

**Responsive collapse:** ≥1280 as above; 768–1279 rail collapses to a 72px
icon-only rail (labels become tooltips + `title`; icons keep 44px targets),
topbar and stage unchanged; <768 rail disappears entirely — topbar stays (56px),
and a **bottom glass tab bar** takes over navigation: acrylic 0.55 / blur 40,
radius 8, 16px inset, 5 items (Sessions, Autoruns, Recordings, Plugins, More →
drawer with Profiles / Import-Export / Settings / user), each ≥44px.

---

## 4. Variant B — "Experimental"

The bold reading: a **monitor-wall deck**. The product's own media stops being
ambient and becomes a permanent region; chrome shrinks to a dark spine and one
floating glass capsule; reading stays on the opaque work log. B is the bolder
variant — it inverts A's "backdrop is ambient" assumption and cuts a window in
the shell for the subject the tool exists to capture.

Explicit delta vs A:

| Field | A "Safe" | B "Experimental" |
|---|---|---|
| Nav | 240px acrylic rail (blur 40) | 64px opaque `secondary` spine (glyphs) + floating glass command capsule |
| Backdrop role | ambient ground only | **`monitor-wall` content region** (right side) showing live stills |
| Top chrome | opaque dark topbar 56px | acrylic command capsule (0.55 / blur 40, radius 8, floating 24px from top) |
| Instruments | tally band inside stage | `instrument-band` on bare media between capsule and work log |
| Depth story | panels float over media, chrome frosted | media is framed as a wall; capsules float in front of it; log is the desk |
| Toast position | bottom-right | bottom-left (right of spine) |
| Drawer origin | right | right (slides over the wall) |

Anatomy (named regions, desktop ≥1280px):

| Region | Position / size | Material | z | Scroll owner |
|---|---|---|---|---|
| `spine` | fixed left edge, 64px | opaque `secondary`; glyph nav 24px stroke icons, active = 2px `primary` left bar (5.51:1) + tooltip; bottom = WS LED | 40 | **none** — fixed glyph strip, overflow hidden |
| `command-capsule` | floating top, inset 24px, width fluid to content | acrylic 0.55 / blur 40, radius 8, luminous edge | 45 | **none** |
| `instrument-band` | row under capsule, over raw media | 2–3 acrylic cards 0.64 / blur 16, **asymmetric spans** (e.g. countdown 2fr, tally 1.2fr, health 1fr) | 10 | none |
| `monitor-wall` | right region, 380–460px | raw media tiles (irregular mosaic: one 2×2 hero + 2–3 small — never three equal); status chips acrylic 0.55/8 over each tile; empty-DB tiles show mesh + `label-caps` "no live sources" | 5 | **monitor-wall** owns its own vertical scroll (job: browse live media) |
| `work-log` | main region left of wall | opaque `surface` slab (radius 8, luminous edge) — tables/forms/lists | 10 | **work-log** — THE vertical scroll owner of the view |
| `overlay-layer` | centered modal / right drawer / bottom-left toast | scrim + 0.72/24 + toast 0.72/40 | 50–70 | **dialog body** / **drawer body** own their own scroll |
| `table-wrap` | inside work-log | opaque | — | horizontal scroll for wide tables (named job) |

z-stack bottom→top: wall media 5 → work-log + instruments 10 → spine 40 →
command capsule 45 → overlay scrim 50 → modal 60 → toast 70.

Where glass sits in B: command capsule, instrument cards, wall status chips,
all overlays. The spine is deliberately dark opaque — it is the deck's frame,
not a pane.

Contents: spine glyphs (Sessions, Autoruns, Recordings, Profiles, Plugins,
Import/Export, Settings) + user glyph; capsule carries view title, one readout
in `label-caps` on an opaque mini-chip (e.g. "3 RECORDING · 1 REMUXING"), the
view's ONE primary button, bell, user menu; instrument-band shows (1) countdown
plate — next autorun "Speedcubing finals" `formatCountdown` at 10s tick, (2)
tally plate — recording/remux/completed counts, (3) health plate — `GET /health`
state + WS mode.

**Responsive collapse:** ≥1280 as above; 768–1279 the wall becomes a
horizontal **reel** under the capsule (scroll-snap 16:9 tiles, keyboard
accessible with arrow keys and visible affordance), instruments reflow to a
single row of two, work-log full width; <768 the capsule becomes a full-width
top bar, the reel stays (tiles 220px), the spine flips to a **bottom tab bar in
opaque dark chrome** (B keeps the spine's dark-glyph language on mobile, where A
uses glass), work-log below.

**Same tokens, same components, same status vocabulary as A** — only shell
anatomy and glass placement differ.

---

## 5. Per-view structure

One table per surface. "Data reads" names only endpoints that exist (Part 3).
Status vocabulary and actions come from §1.4. All lists use cursor pagination
(`PAGE_SIZE` 50, `has_more` → "Load more"; envelope `{items, next_cursor, has_more}`).

### 5.1 Auth — Login

| Aspect | Spec |
|---|---|
| Data reads | `GET /auth/status` (boot: `has_users`), `POST /auth/login`; `GET /health` for the offline banner |
| Fields | username, password (labels above inputs, 16px `weight-ui`); "Sign in" = the ONE primary button |
| Primary action | Sign in → `POST /auth/login` → navigate to Sessions |
| Empty | `has_users:false` → auto-route to Register ("Create first admin account"); no empty state on the form itself |
| Loading | boot splash (wordmark plate + skeleton form) while `/auth/status` pending; submit button enters loading (spinner glyph, label held, width frozen) |
| Error | 401 → inline error under password: "Wrong username or password." (#141414 copy + danger-deep icon). 429 → error panel "Too many attempts — try again in a minute" with `use-rate-limit-lock` countdown. 5xx/network → error panel "Cannot reach the recorder — retry" with Retry. 422 → per-field inline errors from `detail[]` `loc` |
| Dense | n/a (single form) |
| Shell A | full-bleed auth layout: backdrop + glass wordmark plate (0.64/16) + opaque form panel (radius 8, 32px padding, measure 68ch) left-of-center; no rail/topbar |
| Shell B | same split language as the deck: dark spine hidden; glass capsule shows "MIRRORR" only; opaque form slab left; monitor-wall region right shows the mesh/stills with `label-caps` "backdrop — no sources yet" |

### 5.2 Auth — Register

| Aspect | Spec |
|---|---|
| Data reads | `GET /auth/status`; `POST /auth/register {username, password, display_name?}` |
| Fields | username, password, display name (optional, helper text "Shown in the users list.") |
| Primary action | Create account (label flips: `has_users:false` → "Create first admin account"; admin-initiated → "Create user") |
| Empty | n/a |
| Loading | submit loading as login |
| Error | 400 "A resource with that name already exists." (verbatim API detail) as inline error on username; 403 "Not admin" → error panel + return to app; 422 `detail[]` mapped per field via `loc`; 429 (5/min) rate-limit lock |
| Dense | n/a |
| Shell A / B | same auth layouts as 5.1 |

### 5.3 Sessions list (= `index-route`)

| Aspect | Spec |
|---|---|
| Data reads | `GET /sessions/` (cursor pages, `sortByIdDesc`), lookup memo maps from `GET /engines/`, `GET /resolvers/`, `GET /profiles/` (`buildNameMap`, 3 calls total not N×3); WS `/ws/events` delta (`session.*`); polling backstop `LIST_BACKSTOP_MS` 30s / `API_CLIENT_POLL_MS` 10s (API-client principal) / `WS_FALLBACK_POLL_MS` 15s when WS down |
| Row anatomy | status chip (§1.4) · derived title (source URL tail + started time — decision 11.3) · engine → resolver names · profile name · duration (`started_at`→`ended_at`, `formatDuration`) · owner (admin) · row actions from §1.4 action set; remuxing rows grow a determinate progress bar (`RemuxProgress` via `subscribeRemuxProgress`: percent, eta, speed) |
| Primary action | "New session" — dialog: profile picker (one-click prefill) OR direct engine + resolver + dynamic config form + retry mode + recording toggle; POST `/sessions/` starts immediately (no date field) |
| Empty | composed empty state on an opaque panel: "No sessions yet." + body "A session is one capture run. Start one from a profile, or build the config by hand." + primary "New session" + secondary "Open profiles". No fake rows |
| Loading | 8 skeleton rows matching row anatomy exactly (chip block 72×24, title bar 40%, metric blocks right-aligned `tnum`), `tween-enter` opacity only |
| Error | API unreachable → top error banner "Cannot reach the recorder — retry" (`GET /health`); list fetch error → error panel with Retry; WS down → non-blocking chip in the rail footer "Live updates offline — polling" (never a modal) |
| Dense | 50+ rows via "Load more" (cursor); sticky `secondary` header bar with white `label-caps` column labels; compact row height 48px desktop / 56px touch; long titles truncate with ellipsis + `title` |
| Shell A | `stage` (rows in one opaque panel; tally-band above: "3 recording · 1 remuxing" + next autorun countdown — asymmetric spans) |
| Shell B | `work-log` (rows); `instrument-band` carries the tally + countdown; `monitor-wall` shows a still per live session with its status chip |

### 5.4 Session detail

| Aspect | Spec |
|---|---|
| Data reads | `GET /sessions/{id}` (enriched: `attempts`, `session_urls`, `retry_attempts`, `recording`, `status`), WS `session.*` for the live row, remux progress stream while `remuxing`, coalesced telemetry (`session.{id}.telemetry`) while the attempt's processes run |
| Panels | (1) status header — chip + title + duration + owner; under the stats: live readouts — remux progress bar while `remuxing`, else a `Process usage` list (per-process `cpu%` · RSS + summed RSS, `subscribeSessionTelemetry`, hidden while no frame has arrived and once the session leaves the live statuses; never announced); (2) actions row — stop (active/recording), enable/disable recording (active; disabled with tooltip when `engine.capabilities.can_record=false`), save-as-profile (completed/failed), delete (every status except remuxing — hidden, not just disabled); (3) attempts timeline — per attempt: `#index`, status, started/ended (local + tz note), `exit_code`, `reason` on failure; (4) live sources — `session_urls` entries ("M3U8" / "HTML" / "Outplayer") as links; if `[]`: "Live URLs not configured (operator must set `web_url`)." with player affordances disabled — never a spinner (API 13.10.6); (5) config snapshot — engine, resolver, `resolver_config`, `retry_mode`/`retry_config` in `label-caps`+`tnum` readouts |
| Primary action | context action of the current status (Stop while running; Open recording after `recording.created`) |
| Empty | `session_urls: []` state above; attempts `[]` while spawning: "Waiting for the supervisor — attempt 1 not started yet." |
| Loading | skeleton panels (timeline skeleton with 3 attempt rows); optimistic "stopping…" pending chip (`setPendingAction`) reconciled against WS within ~1s |
| Error | control 502/504 → error panel "Control unavailable; session may be stuck — consider delete." + Delete; if no `session.stopped`/status flip within 10s → offer hard delete inline; delete-while-remuxing is impossible (button hidden) but a raced 409 shows toast "Cannot delete while remuxing."; 404 → not-found state "Session gone — it may have been deleted from another client." (cross-client reality, API 13.10.10) |
| Dense | long attempts (retry storms): timeline scrolls inside its own panel (named scroll job), newest attempt pinned |
| Shell A | `stage`: status header panel (full width) + two-column grid (timeline 2fr / sources+config 1fr) — asymmetric, not equal cards |
| Shell B | `work-log` as A's grid; `monitor-wall` shows this session's still as the hero tile while it is live |

### 5.5 Autoruns list

| Aspect | Spec |
|---|---|
| Data reads | `GET /autoruns/`, name lookups as 5.3, WS `autorun.*` + `session.created` (spawn detection), countdown tick `COUNTDOWN_TICK_MS` 10s |
| Framing | **One-shot**: "Scheduled recording — runs once." No weekday/cron pickers anywhere (API 13.11.1). Rows show: status chip (includes `scheduled`), `user_friendly_name`, `snake_case_name` (mono chip), window (local start→end + "stored UTC" note), countdown "starts in 12m" (tick-granular — never second precision), profile/engine→resolver |
| Filter | default "All" (client-side; Oct 14 2026 — was "Upcoming"): every status is shown, spent rows included, and picking a chip narrows to it ("Spent" = completed/failed — will never run again) |
| Primary action | "New scheduled recording" — wizard: name + auto-slug preview (`^[a-zA-Z0-9_-]+$` live-validated, manual override), start/end datetime pickers ("Your local time — stored as UTC"), profile or direct config, recording toggle (default on) |
| Empty | "No scheduled recordings." + "A scheduled recording runs once at its start time and then retires." + primary button |
| Loading | skeleton rows as 5.3 |
| Error | 400 duplicate `snake_case_name` inline on the slug field ("A resource with that name already exists."); 422 tz-suffixed time → inline "Use the local-time picker — times are stored as UTC."; end<start pre-blocked client-side ("End must be after start.") |
| Dense | same table treatment as sessions; past/spent rows dimmed to `text-muted` labels but keep full contrast on the name |
| Shell A | `stage` |
| Shell B | `work-log`; wall shows the live run's still when a spawn happens (auto-highlight via `autorun.updated` + `session.created`) |

### 5.6 Autorun detail

| Aspect | Spec |
|---|---|
| Data reads | `GET /autoruns/{id}`, WS as 5.5; its spawned session (if any) via `GET /sessions/` filtered client-side on `autorun_id` |
| Panels | identity (names + slug), schedule window + countdown, config snapshot, linked run (or "No run yet — it fires once at start time"), history note: "Retired after its run — create a new scheduled recording to repeat" |
| Primary action | "Run now" — client-composed: `POST /sessions/` with this autorun's engine/resolver/config/retry (+ `recording:true` when set). There is no server "run now" endpoint (API 13.10.8); the button is labelled and documented as sugar |
| Hazards (locked) | while status ∈ {active, recording, terminating, remuxing, finalizing}: config fields disabled with label "Changes affect a future run, not the current one."; editing `end_time` of a live run raises confirm "Moving the end time earlier may stop the running recording."; `start_time` in the past is allowed (backfill trigger) but warns "Start time is in the past — the server will fire it immediately." |
| Empty | never (detail of an existing row) |
| Loading | skeleton panel; PUT saves via `exclude_unset` (only changed fields sent) with pending chip |
| Error | 403 "Not your autorun" → error panel; delete confirm copy: "Delete this scheduled recording? It will also stop and delete any running recording it started." |
| Dense | n/a |
| Shell A | `stage` (2-column: schedule+identity 1fr / config 1fr, differing widths) |
| Shell B | `work-log` |

### 5.7 Recordings

| Aspect | Spec |
|---|---|
| Data reads | `GET /recordings/` (cursor), `GET /recordings/{id}` for the drawer; no writes except `DELETE` |
| Row anatomy | `user_friendly_name` + `snake_case_name` (mono chip), poster block (first-frame from `content_url`, `frame` aspect box, degrades to a `label-caps` "no preview" plate), `formatDuration(duration_seconds)`, `formatBytes(size_bytes)` (`tnum`), profile/engine/resolver snapshot names, `created_at` local |
| Primary action | none — this view creates nothing; the loudest control is per-row "Open" (secondary). No primary button on this view (decision 11.7) |
| Empty | "No recordings yet." + "Recordings appear when a session finishes with recording enabled." + secondary "Open sessions" |
| Loading | skeleton rows with poster blocks (never spinners) |
| Error | `content_url` 403/404 → per-row hint "Media not served on this install — copy link instead" + copy button; delete confirm: "Delete this recording? The file is removed from disk — this cannot be undone."; `recording.deleted` WS event removes the row immediately |
| Dense | table with sticky dark `label-caps` header; grid/list toggle inside the same opaque panel (grid tiles are opaque, not glass — they carry reading text); sort by `created_at` desc |
| Shell A | `stage` |
| Shell B | `work-log`; wall hero tile = newest recording's poster |

### 5.8 Profiles

| Aspect | Spec |
|---|---|
| Data reads | `GET /profiles/`, `GET /engines/`, `GET /resolvers/` (for pickers + dynamic forms; invalidated on return to the form — plugins can change on reinstall) |
| Row anatomy | name, engine → resolver names, `retry_mode` chip, owner label (`requester_user_token`) for admins, ref-count (client-side scan of autoruns/sessions) |
| Primary action | **phones**: one "New preset" `Fab` for the whole page (each section used to pin its own `Fab` to the same corner, so on touch the source one won every tap) opening a single dialog whose **Profile \| Source** segmented control picks the kind — the `Fab` is that surface's only create entry, so it is the only place the kind still has to be asked for. **Wide screens** keep one action per section and open the same dialog scoped to that section's kind, with no switcher; edit always locks it to the kind being edited. *Profile*: name (duplicate pre-flagged), then **one config origin** — a resolver picker *or* a copied saved source, chosen by a segmented control, never both at once (switching to "Pick a resolver" keeps the copied resolver + config) — and its **dynamic `resolver_config` form generated from `config_schema`** (typed fields, `enum`→select, min/max, `default` prefill, `required` markers, nested objects as collapsible groups, unknown keys → key/value editor), then the engine picker and the retry mode picker with the dynamic form from `retry_modes_schema.<mode>` (`none|always|count|exit_code`; `default_params` merged on submit), dimmed and inert until an engine is chosen (the modes are the engine's). The picker lists **exactly** the engine's modes and opens on its `none` — which is also what the core falls back to when the mode is absent (`config.get("mode", "none")`), so there is no second “no retry” entry; a placeholder appears only when the value cannot be a mode (an engine declaring none, or a stored mode the engine no longer lists). *Source*: name, resolver picker, the same generated form, plus "Browse `<resolver>`…" when it declares discovery. Numbered blocks read in the order the work happens: Identity · Resolver · Engine & retry, and every block's right-hand note is the same kind of clause — what the block *decides* (`what it's called` / `how the stream is found` / `how it's recorded`), never an instruction and never a question (§6.2). The profile form and the source form use the same titles and the same notes for the same decisions |
| Secondary actions | "Use profile" (navigates to New session prefilled), Export (bundle download), Edit, Delete |
| Empty | "No profiles." + "A profile saves engine, resolver and retry policy for reuse." + primary |
| Loading | skeleton rows; dynamic form shows field skeletons while the schema loads |
| Error | 400 duplicate name inline; 422 mapped to fields via `loc` (e.g. `["body","engine_id"]` → "Field required" under the picker); delete blocked: "In use by 2 autoruns and 1 session — delete those first." (server 400 FK, client pre-empts with counts) |
| Dense | long `config_schema` forms scroll in the dialog body (named scroll job); measure 68ch on help copy |
| Shell A | `stage` (rows) + modal |
| Shell B | `work-log` + modal |

### 5.9 Plugins (Engines & Resolvers)

| Aspect | Spec |
|---|---|
| Data reads | `GET /engines/`, `GET /resolvers/` (`LOOKUP_PAGE_SIZE` 200) — read-only introspection; no writes exist |
| Panel anatomy | two sections (Engines, Resolvers) of **asymmetric** panels (engine panels wider — they carry `retry_modes_schema`): name, description, `origin` + `origin_hash` on an opaque `secondary` code chip (`label-caps` mono, copy button), capability badges (`can_record`, `can_stream` — opaque chips), schema preview in a mono block (`label-caps` headings, 14px+ mono body on opaque ground) |
| Primary action | none (read-only); the loudest control is "Copy hash" (secondary) |
| Empty | "No plugins discovered on this install." + "Mirrorr discovers engines and resolvers from disk at boot." |
| Loading | skeleton panels |
| Error | fetch error → error panel + Retry |
| Dense | schema blocks collapse behind "Show schema" disclosure; hashes truncate to 12 chars with copy-to-clipboard (feedback: chip flips to "Copied") |
| Shell A | `stage` |
| Shell B | `work-log` |

### 5.10 Import / Export wizard

| Aspect | Spec |
|---|---|
| Data reads | `GET /import-export/profiles/{id}/export`, `GET /import-export/autoruns/{id}/export` (export); `POST /import-export/validate` (raw bundle body), `POST /import-export/apply` (import) |
| Export step | multi-select rows (profiles + autoruns) → "Export selected" composes one merged bundle (client-side merge; there is no bulk endpoint) → downloads `mirrorr-bundle-<date>.json`; per-row "Export" secondary |
| Import stepper | 1 Choose file → 2 Validation report → 3 Resolve → 4 Apply → 5 Summary. Stepper labels in `label-caps` on an opaque chrome bar |
| Step 2 data | one `validate` call; grid of items with per-item badge: valid / warning / error; issues rendered verbatim: `not_installed`, `hash_mismatch`, `already_exists` ("already imported — skip", default, with "import as copy" option), `name_conflict` (rename preview `name_2`…`name_199`), `profile_missing`, `engine_override` |
| Step 3 data | plugin-mapping pickers per unresolved `origin_hash` (dropdown of installed engines/resolvers, "choose manually" fallback) → builds `plugin_map`; include/exclude toggles per item (default ALL included; `removed_*` sent only when the user excludes); bundle guard: `MAX_BUNDLE_ITEMS` 500 → warn before Apply, not after |
| Primary action | step 1–2 "Validate bundle"; step 3 "Apply import" (the ONE primary); step 5 "Done" (secondary) |
| Empty | no file chosen: drop zone "Drop a bundle (.json)" + "Bundles carry profiles and scheduled recordings — never media." |
| Loading | validate spinner (one call) + skeleton grid; Apply shows counts rolling in the summary |
| Error | non-JSON / `version ≠ 1` → error panel "Unsupported bundle version — this console reads version 1 bundles."; Apply 400 → error panel with server detail; partial success summary still shown with counts `profiles_created / profiles_skipped / autoruns_created` |
| Dense | 100+ item bundles: the validation grid is its own scroll region, items grouped valid/warn/error, sticky group headers |
| Shell A | `stage` (stepper + one opaque panel per step) |
| Shell B | `work-log` (same), wall dimmed to mesh while the wizard is open (focus on data) |

### 5.11 Settings (account / users / clients)

| Aspect | Spec |
|---|---|
| Data reads | account: `GET /auth/me`, `POST /auth/change-password`; users (admin): `GET /auth/users`, `DELETE /auth/users/{username}`; clients (admin): `GET /auth/clients`, `POST /auth/clients {name}`, `DELETE /auth/clients/{id}` |
| Tabs | Account · Users · Clients — `label-caps` tabs on opaque chrome; non-admins see Account only (server 403s, client hides) |
| Account panel | display name, role (read-only chip), change-password form (old, new, confirm; helper "Changing your password signs you out everywhere.") |
| Users panel | rows: `username`, `display_name`, role chip (admin/user); delete secondary; last-admin guard: delete disabled + inline "Cannot delete the last admin." when the list has one admin (server 400 as backstop) |
| Clients panel | rows: name, `is_active`, `created_at`, "Programmatic access key — treat like a password." banner; Create key → modal returns `plaintext_key` **once**: mono copy field (`label-caps` "shown once"), copy button, warning "This key is shown once. Copy it now — it cannot be retrieved again."; delete confirm "Revoke this key? Anything using it loses access." |
| Primary action | Account: "Change password"; Users: none (delete only); Clients: "Create key" |
| Empty | Clients: "No API clients." + "An API key acts as a non-human principal with owner-scoped access."; Users: never empty (self exists) |
| Resource access panel (admin) | A 4th administration panel (**Resource access**): a **type** `Select` + an **owner** `Select` (users from `fetchUsers`) + a page-local filter `Input`, then a paged table — `label` · type · owner · viewers. A per-item `Dialog` (`Access · <label>`) edits access through the one shared editor (§5.14) as a **draft**: nothing is written until **Apply changes** is pressed. That is one editing model, shared with the per-item card and the bulk panel (§5.14). **System rows** (engines/resolvers — ownerless) render a `System` `Tag` and no manage action; a deleted owner renders `<owner> (missing)` (danger colour). Server-computed `label`; the filter ranks the loaded page client-side (`rankBySearch` over `[label, owner]`), never a server search. |
| Where it surfaces | The **admin build's** settings page only: `__ADMIN__`-gated, `mirrorr-web/src/admin-surface.tsx` (`ResourceAccessSection`, inside `AdministrationSection`), contributed by `src/admin.tsx` through the generic settings-section slot (`ui/views/settings/sections.tsx`). The standard bundle carries zero admin strings. |
| Loading | skeleton rows |
| Error | 400 "cannot delete last admin" inline; 422 on password fields inline; 403 on admin tabs → hide for non-admins |
| Dense | users/clients tables with sticky dark headers |
| Shell A | `stage` + modal (key reveal, confirm dialogs) |
| Shell B | `work-log` + modal |

### 5.12 Not-found

| Aspect | Spec |
|---|---|
| Data reads | none |
| Content | "No console at this address." + `label-caps` line of the attempted path (truncated, `overflow-wrap: anywhere`) |
| Primary action | "Back to sessions" |
| Empty / Loading / Dense | n/a |
| Error | this surface IS the route-level error fallback; a resource 404 inside a valid route renders the per-view error state instead |
| Shell A | `stage` (opaque panel) inside the standard shell (rail + topbar stay) |
| Shell B | `work-log` inside the deck (spine + capsule stay) |

### 5.13 Cross-cutting surface behaviours

- **API-client principal** (`isApiClientPrincipal()`): a chrome-dark banner under
  the topbar/capsule: "API client session — polling every 10s" and, on created
  resources, "Created as a system/API-client resource — it appears in no user's
  feed and fires no notifications." (API 13.10.1; there is no adopt/transfer
  endpoint — the hint is the whole truth).
- **Notifications**: bell + unread badge (WS `/ws/notifications` live feed is the
  primary stream; `GET /notifications/` is history — never join the two on `id`,
  API 13.10.2). Drawer lists REST rows (read/unread, mark read, mark all, delete);
  synthetic WS frames toast immediately (crash/failed/completed, configurable)
  and navigate on click to `resource_type/:id`. API-key principals see
  "Notifications require a user session." instead of the drawer (401 by design).
- **Time**: every naive-UTC value renders local with a tz note; inputs carry
  "converts to UTC on save"; `formatDateTime`, `formatRelativeTime`,
  `formatCountdown`, `formatBytes`, `formatDuration` from the spine.

### 5.14 Per-item access (admin build only)

Ownership and view access are editable **on each item**, not only from the settings panel.
Nothing here renders in the standard build: the affordances reach the shared lists through
`ResourceAccessSlotContext`, provided only by `src/admin.tsx` (§5.11 "Where it surfaces").

| Aspect | Spec |
|---|---|
| Affordance | a small `IconUser` `IconButton` (accessible name `Access for <label>`) in the action set of every owner-bearing row/card — sessions (§5.3), autoruns (§5.5), recordings (§5.7), presets and sources (§5.8) |
| Pointer | **one centered floating modal for every pointer type** — a `Dialog` (`size="xl"`, title `Access · <label>`), never an edge-docked sheet. Every click inside it is stopped at the affordance boundary, so it never reaches the row/card's own click handler |
| Content | the **one** shared editor that the settings dialog and the per-item panel mount (the **bulk** panel does **not** — `BulkAccessDialog` keeps its own owner + viewer-set, VIEW-only UI), so the surfaces cannot drift: an **owner row** (crown + avatar + name + **Change**, which puts the catalog into a single-pick **owner mode** — "Pick the new owner"), a client-side user search ("Search users…", `rankBySearch` over `[display_name, username]`), an **upper** **multi-select** capability chip row (an `All` chip that is active only while nothing is selected and clears the selection, plus one chip per capability the item type actually enforces — a capability with no route for that type is not offered — each carrying the **count** of holders; **each capability chip cycles off → green → red → off** — green keeps the users who **hold** it, red keeps the ones who **do not** — and the chips **AND** (every green must be held, every red must not), which is what makes `green X` + **Select all** a bulk-grant to exactly the users who lack X; both chip rows wrap rather than scroll so no chip hides at 375px and both stay at two lines — the old separate `Invert` chip is gone, its job now being the red state of the chip it applied to) that **filters** the catalog, then **one** catalog of portrait cards — avatar over display name over `@handle`, ≥3 per row at 375px — where a tap toggles, **Select all** takes everything the current filter+search shows, **Clear** empties it, and a drag whose first motion is horizontal starts a marquee (vertical motion scrolls instead) that auto-scrolls within 48px of the catalog's top/bottom edge; then a `N selected` readout and a **lower** **tri-state** chip row (all / `mixed` / none) that sets that capability for every selected card — tapping it when the state is *not* all applies it to all, otherwise clears it; disabled when nothing is selected. The owner is never a grant target (the server excludes them from `grants`) and is edited only from the owner row. Cards carry **no** capability indicators; the panel is height-capped so the catalog is the one scroll region while the title, both chip rows and the footer stay pinned. A footer carries the dirty readout ("Unsaved changes" / "Up to date") and **Apply changes**, disabled until dirty. **VIEW is the base capability**: applying any other capability also stores `VIEW`, unticking `VIEW` warns ("Clearing View access also clears every other capability.") and drops that user's other capabilities, and a user holding any capability reads as holding `VIEW` — so `View access` is one chip row, not an independent section |
| Override tag | the item's own access, as far as the data proves it — `Owner account missing`, or `N users with access` (the count is distinct users holding any capability). A past owner transfer is **not** recoverable (`PUT …/owner` overwrites `requester_user_token`), so it is deliberately never claimed |
| Bulk | the four select-mode lists (sessions, autoruns, presets, sources) gain an **Access** action in the `BulkBar`, opening a `size="lg"` dialog: "Change owner" + owner `Select`, "Replace view access" + user checkboxes, a `N change(s) planned` summary carrying `N already overridden`, then the selected items with from → to |
| Confirm | when the draft would replace an item's own access, **Apply to N** opens a confirm instead of sending: title `Override N item(s)?`, the affected items with their from → to, then **Override and apply** or **Back to editing**. Nothing is sent before that |
| Writes | the per-item `/shares/` routes, fanned out client-side (one op per item, in order); an item that fails is reported and the rest still apply |
| States | skeleton rows while the per-item access loads; `ErrorPanel` with retry when it fails |

---

## 6. Component state matrices

States: Default / Hover / Active / Focus / Disabled / Loading / Error / Empty.
"O-twin" = opaque twin of the acrylic recipe. Motion tokens in parentheses are
the only animation allowed for that transition (§9). Every control is ≥44px on
coarse pointers. `#141414` carries all words; hue never carries meaning alone.

### 6.1 Buttons

| Control | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty |
|---|---|---|---|---|---|---|---|---|
| button-primary | `primary` fill, `surface` label 16px/500, radius 4, pad 12×20; one per view | fill darkens 6% (mix toward `#0F45D6`) | `scale(0.96)` (`micro`), fill darkens 10% | `--focus-ring` (§8.3) | fill `secondary`@45%, label `#141414`@55% (4.06:1, WCAG inactive exception), `not-allowed` | spinner glyph replaces leading icon, label + width frozen | fill → `danger-deep` (#D01431, white label 5.49:1) for 1.2s then restore (`ui`) | — |
| button-secondary | acrylic 0.64/16 or O-twin; `text` label; radius 4; pad 11×19; luminous edge | tint 0.08→0.14 | tint deepens + `scale(0.96)` (`micro`) | `--focus-ring` | opacity 0.55, no press | spinner + frozen label | 1px `danger-deep` keyline + inline error copy beside it | — |
| button-destructive | `danger-deep` fill, white label | fill `#B01029` | `scale(0.96)` (`micro`) | `--focus-ring` | as primary disabled | frozen label + spinner | stays error-styled; toast repeats detail | — |
| button-ghost (icon) | 40×40 (44 coarse), transparent, `text` icon | O-twin chip behind icon (radius 4) | `scale(0.96)` (`micro`) | `--focus-ring` | icon `#141414`@45% | icon → spinner glyph | icon swaps to danger-deep `!` for 1.2s | — |

### 6.2 Inputs & forms

| Control | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty |
|---|---|---|---|---|---|---|---|---|
| input (text/number) | acrylic 0.72/16 or O-twin (white fill + luminous edge); radius 4; pad 12×14; 16px text | 1px `glass-border` → `edge-near` brighten | caret blinks | `--focus-ring`; **not** a glow | fill 0.45 alpha, label `#141414`@55% | trailing spinner glyph (schema resolving) | 2px `danger-deep` underline + inline copy below (aria-describedby, `aria-invalid`) + icon | value empty shows placeholder `#6E6E6E` (5.10:1) — never placeholder-as-label |
| select / combobox | as input + chevron glyph | chevron darkens | listbox opens (`ui`); selected row = `primary` 2px left bar | `--focus-ring` on trigger; listbox options use `--focus-ring` on the active option | as input | trailing spinner | inline error as input | "No options." row in listbox |
| switch | 44×24 track (radius 4 per closed scale — track is a control, not a card); off = `secondary`@30% track + white knob | track brightens | knob slides (`micro`), on = `primary` track | `--focus-ring` | track @20%, knob flat | track shows spinner glyph | track `danger-deep` + inline copy | — |
| form field + fieldset | label 16px/500 above (8px gap), helper `#6E6E6E` below (8px gap); groups inside a dialog are fieldsets — an uppercase title, an optional step index, and at the right a **lowercase clause saying what the group decides** ("what it's called", "how the stream is found", "how it's recorded") rather than an instruction or a question; every control carries a short label above it (never a bare question as a field label), a group's second-level parts (generated config fields, retry) get their own sub-heading, and a choice between two ways to fill the same group is a segmented control under a label; measure 68ch on help copy | — | — | fieldset outline `--focus-ring` when any child focused | all children disabled, helper explains why (e.g. "Locked while this run is live.") | field skeletons | 422 `loc` errors mapped per field | required marker `*` + `aria-required` |

### 6.3 Chips, badges, status

| Control | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty |
|---|---|---|---|---|---|---|---|---|
| chip (filter/tag) | acrylic 0.55/8 or O-twin; radius 4; pad 8×12; label 16px on acrylic / 12px `label-caps` on O-twin | tint 0.08 | selected: `primary` 2px left bar + `scale(0.96)` (`micro`) | `--focus-ring` | opacity 0.55 | shimmer-free skeleton block | 1px `danger-deep` keyline | — |
| status chip | O-twin chip always; icon (§1.4) + word `#141414` + indicator hue as 3px left bar + dot | row-level only (chip itself static) | — | `--focus-ring` when clickable (→ detail) | — | word held, dot → spinner glyph | `failed` styling (icon + `danger` bar) | `unknown` styling (hollow ring, no hue) |
| badge (count) | 20px min circle, `primary` fill, white `tnum` 12px `label-caps` on opaque fill (5.51:1) | — | `scale(0.96)` (`micro`) on bump | `--focus-ring` when it opens the drawer | hidden when 0 | pulse-free pending dot | `danger-deep` fill on failure counts | 0 → hidden, not "0" |

### 6.4 Table, rows, menus

| Control | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty |
|---|---|---|---|---|---|---|---|---|
| table row | opaque white row, 1px `glass-border` divider (`border-t`/`divide-y` rhythm — no per-row shadow), 48px height | `secondary`@4% wash + row actions fade in | row press `scale(0.998)` (`micro`); selected = `primary` 2px left bar | `--focus-ring` on the row link; row itself `tabindex` only when it is the primary target | rows with pending action: actions frozen, pending chip | 8 skeleton rows (§5.3 shape) | row-level error strip under the row (danger-deep keyline + copy) | empty-state panel replaces the table body; header stays |
| row actions | overflow menu trigger (⋯ glyph, 44×44) + up to 2 direct secondaries per §1.4 action set | menu trigger gets O-twin chip | menu opens (`ui`); item press `scale(0.96)` | `--focus-ring` per item, roving | actions not in the status action set are **absent**, not disabled (delete during remuxing is hidden) | trigger shows spinner glyph | toast + inline strip | — |
| overflow menu | acrylic 0.72/24 panel (modal tier), radius 4, 8px pad, items 44px | item wash `secondary`@8% | `scale(0.96)` item (`micro`) | `--focus-ring`; Esc closes, focus returns | items disabled with inline reason text | — | — | menu not rendered when no items |
| dialog | acrylic 0.72/24 over scrim, radius 8, pad 32, `max-width: min(32rem, 100vw - 32px)`; enters `tween-enter` | — | — | focus trapped inside; initial focus on first field; return to trigger on close | form fields inherit | body skeletons; submit frozen | inline errors; footer keeps actions | — |
| confirm dialog | as dialog + copy states consequence verbatim ("This will stop and delete any running recording.") | confirm button as button-destructive hover | `scale(0.96)` (`micro`) | focus starts on Cancel (safe default) | confirm disabled while server busy | confirm shows spinner | toast + dialog stays open with detail | — |
| toast | acrylic 0.72/40, radius 4, pad 12×16, icon + 16px copy + optional action; enters (`ui`), exits (`tween-enter`); max 3 stacked | action link underlines | action `scale(0.96)` | `--focus-ring` on action; Esc dismisses | — | — | error variant: `danger-deep` icon + left bar, copy `#141414`; 502/504 wording per §5.4 | — |
| drawer / panel | acrylic 0.72/24 sliding from right (over wall in B), radius 8, own scroll body | header close glyph chip | `scale(0.96)` close (`micro`) | focus trapped; Esc closes | — | body skeletons | inline error panel + Retry | "Nothing here yet." copy per surface |

### 6.5 Feedback surfaces

| Control | Default | Hover | Active | Focus | Disabled | Loading | Error | Empty |
|---|---|---|---|---|---|---|---|---|
| empty state | opaque panel, `label-caps` eyebrow (max 1 per view), 16px body ≤25 words, primary + ≤1 secondary CTA, optional 40px stroke icon | CTA hover per button rows | CTA active per button rows | CTA focus per button rows | — | — | — | this IS the empty form: composed per §5 copy, never lorem |
| error panel | opaque panel, `danger-deep` 3px left bar + icon + `#141414` copy (18.42:1) + Retry secondary + "Details" disclosure (mono block, opaque) | Retry hover | Retry active | `--focus-ring` | — | Retry spinner | — | — |
| skeleton | opaque blocks (`secondary`@8–14% wash, radius 4), shaped like the final layout; no shimmer, no spinner-by-default | — | — | — | — | this IS the loading form | — | — |
| nav item (rail/spine/tabs) | 44px target; active = `primary` 2px left bar (rail) / bottom bar (tabs) + `weight-ui` label; inactive label `#141414`@90% (4.59:1 worst-case acrylic — AA at 16px, see 8.2 row 12) | label → full `#141414` (5.19:1) | `scale(0.96)` (`micro`) | `--focus-ring` | hidden for non-admin items (users/clients), not disabled | — | — | — |
| tab | `label-caps` on opaque chrome strip; active tab = `surface` plate (radius 4 top) with `#141414` label; inactive label `surface`@70% on `secondary` (≥7:1) | label → 100% | indicator slides (`ui`) | `--focus-ring`, Arrow keys move (roving) | — | tab panel skeletons | panel error state | panel empty state |

Notes: (a) status words, error copy and body copy are always `#141414` on light
grounds — red/amber/green text is banned (hard law 7); (b) no control uses a
second radius language — every corner in this matrix is 0, 4 or 8; (c) glass
press (`micro`) replaces any transform-based hover lift — hover never implies
elevation.

---

## 7. Responsive

Breakpoints (page frame only): `--bp-compact` <768px, `--bp-medium` 768–1279px,
`--bp-wide` ≥1280px. Components respond to their container, not the viewport.

| Concern | 375px | 768px | 1280px |
|---|---|---|---|
| Variant A shell | topbar 56px + stage + bottom glass tab bar (acrylic 0.55/40, radius 8, 16px inset, 5 items ≥44px) | 72px icon rail (tooltips) + topbar + stage | 240px acrylic rail + topbar + stage |
| Variant B shell | capsule → full-width top bar; spine → opaque dark bottom tab bar; reel 220px tiles; work-log below | spine 64px + capsule + horizontal reel (16:9, scroll-snap) + work-log | spine + capsule + instrument band + wall 380–460px + work-log |
| Tables | row-cards (each row becomes a card: chip + title + 2-col metric grid) — container query <42rem | full table, secondary columns hidden (engine/resolver move to row detail) | full table, sticky dark header |
| Forms | fieldsets stack, dialog → full-screen sheet (radius 0 top), primary action pinned bottom ≥44px | 2-column field grid | 2–3 column field grid, measure 68ch on help |
| Instrument cards (A tally / B band) | 2 plates stacked, spans 1fr/1fr but heights differ (asymmetric) | 2 plates, 1.6fr/1fr | 3 plates, 2fr/1.2fr/1fr |
| Wall/reel (B) | reel horizontal | reel horizontal | wall vertical mosaic (hero 2×2 + small tiles) |
| Type | h1 clamp floor 2rem; body 16px fixed | h1 clamp mid | h1 3rem |

Container-query rules (all components):
```css
.panel { container-type: inline-size; }
@container (max-width: 42rem) { .table--rows { display: block; } .table--rows > tr { card layout } }
@container (max-width: 30rem) { .field-grid { grid-template-columns: 1fr; } }
@container (min-width: 22rem) { .wall-tile--hero { grid-column: span 2; grid-row: span 2; } }
.wall-grid { grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr)); }
```
Breakpoint names only (`--bp-compact` never `--bp-ipad`). Content reflows to
320px with no horizontal scroll of primary content; wide tables scroll inside
`table-wrap` only. 200% zoom: layout holds, touch targets grow, nothing clips.

Touch: `@media (pointer: coarse)` enforces min 44×44 targets on every control in
§6 and ≥8px visual gap between adjacent targets (WCAG 2.2 AA floor is 24px
target size / 24px spacing — we exceed it by design); row actions become icon
buttons instead of hover-revealed text.

Mobile shell summary: Variant A = dark topbar + scrolling stage + **glass** bottom
tabs; Variant B = glass top bar + reel + scrolling work-log + **dark** bottom
tabs. The material difference between the two variants survives to 375px.

---

## 8. Accessibility

Target: WCAG 2.2 AA, measured at the worst-case pixel over media. Numbers below
are computed from the exact hex/alpha values in §1 (sRGB relative luminance,
`(L1+0.05)/(L2+0.05)`); "passes" is stated only next to a number.

### 8.1 Measurement conventions

- Acrylic worst case = the tier's white alpha + `glass-tint` composited over
  **near-black media** (L≈0 worst backdrop). Over brighter media ratios only rise.
- Scrim worst case = scrim composited over **pure white media** (the brightest
  backdrop a white text run can face).
- All ratios are contrast of the stated foreground on the stated background.

### 8.2 Computed contrast table

| # | Foreground | Background | Ratio | Use / verdict |
|---|---|---|---|---|
| 1 | `#141414` text | `#FFFFFF` surface | 18.42:1 | body copy — passes 4.5 |
| 2 | `#141414` label | worst-case acrylic 0.55+tint (chip/nav over black media) | 5.19:1 | 16px labels on chips/nav — passes 4.5 |
| 3 | `#141414` label | worst-case acrylic 0.64+tint (card) | 6.79:1 | 16px labels on instrument cards — passes 4.5 |
| 4 | `#141414` label | worst-case acrylic 0.72+tint (modal/input/toast) | 8.49:1 | 16px labels on overlays — passes 4.5 |
| 5 | `#FFFFFF` label | `#1856FF` primary button fill | 5.51:1 | 16px button labels — passes 4.5 |
| 6 | `#1856FF` link | `#FFFFFF` surface | 5.51:1 | body links (underlined at rest) — passes 4.5 |
| 7 | `#FFFFFF` label | `#3A344E` chrome (topbar/spine/table headers) | 11.79:1 | `label-caps` 12px on dark chrome — passes 4.5 |
| 8 | `#FFFFFF` copy | `--scrim-45` over white media | 3.00:1 | large text (≥24px) only — passes 3.0 exactly |
| 9 | `#FFFFFF` copy | `--scrim-55` over white media | 4.06:1 | large text only — fails 4.5 for normal; use 65 |
| 10 | `#FFFFFF` copy | `--scrim-65` over white media | 5.74:1 | normal text over media — passes 4.5 |
| 11 | `#FFFFFF` copy | `--scrim-75` over white media | 8.19:1 | dense text over media — passes 4.5 |
| 12 | `#141414`@90% nav inactive label | worst-case acrylic 0.55 | 4.59:1 | 16px. Raised from 80% to 90% in this revision: 1.4.3 covers every persistent navigation label and 80% computed 3.99:1 — a real AA miss, not a decorative carve-out. Hover lifts to 100% (5.19:1) and the active route carries the primary bar. |
| 13 | `#05A257` success-deep indicator | `#FFFFFF` | 3.33:1 | non-text shapes — passes 3.0 |
| 14 | `#C9722F` warning-deep indicator | `#FFFFFF` | 3.54:1 | non-text — passes 3.0 |
| 15 | `#EA2143` danger indicator | `#FFFFFF` | 4.38:1 | non-text — passes 3.0 |
| 16 | `#1856FF` primary indicator | `#FFFFFF` | 5.51:1 | non-text — passes 3.0 |
| 17 | `#3A344E` secondary indicator | `#FFFFFF` | 11.79:1 | non-text — passes 3.0 |
| 18 | `#141414` on `#07CA6B` fill | | 8.48:1 | hue fill carrying words (row accent bars) — passes 4.5 |
| 19 | `#141414` on `#E89558` fill | | 7.78:1 | same — passes 4.5 |
| 20 | `#141414` on `#EA2143` fill | | 4.21:1 | **banned** — fails 4.5 for body; danger fills never carry text at 16px |
| 21 | `#FFFFFF` on `#D01431` danger-deep fill | | 5.49:1 | destructive button label — passes 4.5 |
| 22 | `#6E6E6E` helper/placeholder | `#FFFFFF` | 5.10:1 | helpers + placeholders (opaque grounds only) — passes 4.5 |
| 23 | disabled label `#141414`@55% | `#FFFFFF` | 4.06:1 | inactive components — WCAG 1.4.3 exception applies; stated, not hidden |
| 24 | `#141414` error copy | `#FFFFFF` | 18.42:1 | error text is `#141414` + danger icon/bar (hard law 7) — passes 4.5 |
| 25 | focus ring `#1856FF` layer | `#FFFFFF` | 5.51:1 | ring vs light ground — passes 3.0 |
| 26 | focus ring `#1856FF` layer | worst-case acrylic 0.64 | 2.03:1 | fails alone → carried by keyline |
| 27 | focus ring `#141414` keyline | worst-case acrylic 0.64 | 6.79:1 | ring vs dark-media ground — passes 3.0 |
| 28 | focus ring `#141414` keyline | `#FFFFFF` | 18.42:1 | passes 3.0 |

### 8.3 Focus rings

Two-layer ring, built in the shadow layer (vercel mechanism — no box-model
clipping): `0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-primary),
0 0 0 5px var(--color-text)`. Why two layers: the primary ring alone measures
2.03:1 against worst-case acrylic (row 26) and the white gap alone 2.71:1 —
neither clears 3:1 on dark media. The dark keyline clears 3:1 on every ground
(rows 27–28) and the primary ring clears 3:1 on light grounds (row 25), so the
indicator as a whole always has a ≥3:1 boundary. Focus is never a glow.

### 8.4 Keyboard paths

- Skip link (first tab stop): "Skip to the work surface" → stage/work-log.
- Tab order: skip link → nav (rail/spine/tabs) → topbar/capsule → stage content.
  Sticky chrome never obscures the focused element (`scroll-margin-top: 64px` on
  stage children — WCAG 2.4.11).
- Dialogs/drawers: focus trapped, Esc closes, focus returns to the trigger
  (API contract 12.4). Confirm dialogs open with focus on Cancel.
- Menus/listboxes: ArrowUp/Down, Home/End, Enter, Esc; comboboxes add typeahead;
  tabs use roving tabindex + ArrowLeft/Right.
- Tables: row link is the tab stop; row actions reachable via the overflow menu
  (⋯ is focusable); status chips with navigation are links.
- Switch: Space/Enter toggles; every switch has a visible label (not colour-only).
- Every destructive path is confirm-dialog mediated (sessions, autoruns with
  live-run warning, recordings, profiles, users, client keys).

### 8.5 Live regions

| Region | Politeness | Content |
|---|---|---|
| status announcer (visually hidden, per row/detail) | `aria-live="polite"` | status transitions from WS: "Session 5 status: Recording" |
| toast region | `polite` for success/info; `assertive` only for `session.crashed` and control 502/504 | toast copy + action |
| bell badge | `polite` | "3 unread notifications" (increments/decrements with the WS feed) |
| remux progress | `polite`, throttled to one announcement per 10% | "Remux 42 percent" |
| API-offline banner | `assertive` on first transition only | "Cannot reach the recorder — retry" |
| countdown | not live (re-rendered text; announced on demand via `title`/aria-label) | — |

Status chips expose `aria-label="Status: Recording"` so icon+word doubling is
also programmatic. Forms: labels paired (`<label for>`), errors via
`aria-describedby` + `aria-invalid`, 422 `loc` errors focus the first invalid
field.

### 8.6 Reduced motion & reduced transparency

- **Reduced motion** (`prefers-reduced-motion: reduce`, root
  `<MotionConfig reducedMotion="user">`): parallax travel held at 0 (§9.3);
  transform/layout animation dropped; short opacity drops (0.2s `tween-enter`)
  survive; recording pulse becomes a static dot; progress bars still fill
  (data, not motion); nothing vanishes without a transition.
- **Reduced transparency** (`prefers-reduced-transparency: reduce`): every
  acrylic surface swaps to its opaque twin (§1.3) — nav/capsule → `--glass-nav`
  rendered as solid `#FFFFFF` with luminous edge; modals/toasts → solid white;
  chips → solid white; dark chrome stays. `backdrop-filter` is removed entirely.
  Solid fills are computed as the acrylic's own alpha resolved onto `#FFFFFF`
  (e.g. 0.55 white → `#8C8C8C`-equivalent is wrong — instead render
  `background: #FFFFFF` with the same luminous edge, keeping text at 18.42:1).

---

## 9. Motion inventory

Root: `<MotionConfig reducedMotion="user">` (mandatory, motion-dev). Import from
`motion/react`. Every job below maps to exactly one token; durations/stiffness
are never re-invented. Transform/opacity only.

| # | Job (named) | Token | Behaviour |
|---|---|---|---|
| 1 | button / icon-button press | `micro` | `whileTap scale(0.96)` spring(400/30) |
| 2 | chip select toggle | `micro` | `scale(0.96)` + left-bar grow |
| 3 | switch knob slide | `micro` | track colour + knob x via spring(400/30) |
| 4 | badge count bump | `micro` | `scale(0.96)` on change |
| 5 | overflow menu / dropdown open-close | `ui` | opacity + 4px y, spring(300/24) |
| 6 | tab indicator slide | `ui` | `layoutId` indicator, spring(300/24) |
| 7 | nav active-indicator slide (rail/spine/tabs) | `ui` | `layoutId` bar, spring(300/24) |
| 8 | toast enter | `ui` | opacity + 8px y, spring(300/24) |
| 9 | chip "Copied" / button error flash | `ui` | state swap, spring(300/24) |
| 10 | dialog + drawer enter/exit | `tween-enter` | `AnimatePresence mode="wait"` (stable key); scrim fade + panel opacity first; exit quieter |
| 11 | toast exit | `tween-enter` | opacity-first, 0.2s easeOut |
| 12 | skeleton → content crossfade | `tween-enter` | opacity only, 0.2s easeOut |
| 13 | remux progress step (~5s cadence) | `tween-enter` | bar width eases 0.2s easeOut per data step |
| 14 | recording dot pulse (`StatusDot:"pulse"`) | `tween-enter` | opacity 1→0.45→1, one half-cycle per 0.2s easeOut |
| 15 | spinner arc (terminating/remuxing/finalizing dots) | `tween-enter` | quarter-turn per 0.2s easeOut (0.8s per rotation — derived from the token, not a fifth number) |
| 16 | route change / shared-element row→detail title | `page` | `layoutId` morph + opacity, spring(350/35) |
| 17 | whole-view content enter (stage swap) | `page` | opacity + 8px y once per route |
| 18 | wall hero tile change (variant B) | `page` | `layoutId` tile, spring(350/35) |

**The one licensed parallax:** between backdrop and acrylic only —
`useScroll` + `useTransform`, backdrop `y: -40px → 40px`, `clamp: false`, linear
(scroll-mapped); acrylic chrome drifts at 0.25× of that travel; opaque panels
ride normal scroll with no offset. Nothing else in the console uses scroll-linked
motion.

**Reduced motion (9.3):** jobs 1–9 and 16–18 drop transform/layout and keep a
0.2s `tween-enter` opacity drop; jobs 10–12 keep opacity only; 13 keeps filling
(data); 14 becomes a static dot; 15 becomes a static ring with the word doing the
work ("Stopping…"); the parallax holds at `y: 0` for the whole scroll range.

---

## 10. Realistic content

Every string below is production-shaped copy. Sessions carry no name field in the
API, so their display label is derived (decision 11.3): source tail from
`resolver_config.url` + local start time.

### 10.1 Sessions list (rows)

| id | Label | Status | Started (local) | Duration | Engine → Resolver | Profile |
|---|---|---|---|---|---|---|
| 12 | twitch.tv/lofi_girl · 21:04 | Recording | 21:04 | 01:12:33 | yt_dlp_piped → static | yt-dlp piped — default |
| 11 | youtube.com/watch?v=l8WbTtG8pEo · 19:30 | Remuxing | 19:30 | 02:14:37 | yt_dlp_piped → static | arena high-bitrate |
| 10 | cams.example.net/harbour-2 · 18:15 | Stopping… | 18:15 | 01:49:02 | yt_dlp_piped → static | harbour-cam static HLS |
| 9 | twitch.tv/nordschleife_cam · 16:02 | Completed | 16:02 | 02:58:11 | yt_dlp_piped → static | yt-dlp piped — default |
| 8 | youtube.com/watch?v=9kRj2bQp1Zs · 14:41 | Failed | 14:41 | 00:00:47 | yt_dlp_piped → static | workshop backup (no-record) |
| 7 | cams.example.net/harbour-2 · 12:00 | Completed | 12:00 | 03:00:05 | yt_dlp_piped → static | harbour-cam static HLS |
| 6 | (spawned by autorun 5) · 09:30 | Finalizing | 09:30 | 01:02:10 | yt_dlp_piped → static | harbour-cam static HLS |

Attempt reasons (failed row 8): "yt-dlp exited with code 1: Unable to download
JSON metadata: HTTP Error 403: Forbidden"; retry attempt #3 of 3:
"resolver join timed out after 30s".

### 10.2 Session detail readouts

Status chip: "● Recording" (record disc, pulse). Live sources panel when
`session_urls: []`: **"Live URLs not configured (operator must set `web_url`)."**
With URLs: `M3U8` / `HTML` / `Outplayer` link chips. Config snapshot:
`retry_mode: count (3 · delay 5.0)` · `engine: yt_dlp_piped` ·
`resolver: static · url: https://twitch.tv/lofi_girl`. Owner (admin):
`requester_user_token: obs-bot`. Control error: **"Control unavailable; session
may be stuck — consider delete."** Pending chip: "stopping…" (lowercase, with
the ellipsis — reconciled by WS).

### 10.3 Autoruns

| id | user_friendly_name | snake_case_name | Window (local) | State |
|---|---|---|---|---|
| 5 | Harbour cam — evening | harbour_cam_evening | 2026-09-30 18:00 → 22:00 | Spent (Completed) |
| 6 | Speedcubing finals | speedcubing_finals | 2026-10-03 02:25 → 04:30 | Scheduled — starts in 2d 5h |
| 7 | Lo-fi radio overnight | lofi_radio_overnight | 2026-10-01 23:30 → 07:00 | Scheduled — starts in 1d 2h |
| 8 | VCT Pacific — playoffs | vct_pacific_playoffs | 2026-10-05 10:00 → 14:00 | Scheduled |
| 9 | Speedrun WR attempts | speedrun_wr_attempts | 2026-10-02 20:00 → 23:30 | Live (Recording) |

Framing copy: "Scheduled recording — runs once." / "Retired after its run —
create a new scheduled recording to repeat." Countdown: "starts in 1d 2h"
(tick-granular). Slug validation: `speedrun-wr-attempts` rejected inline —
"Use letters, numbers, _ or - only." Hazard copy: "Changes affect a future run,
not the current one." / "Moving the end time earlier may stop the running
recording." / "Start time is in the past — the server will fire it immediately."

### 10.4 Recordings

| id | user_friendly_name | snake_case_name | Size | Duration | Profile / engine |
|---|---|---|---|---|---|
| 3 | Harbour cam — 2026-09-29 evening | harbour_cam_20260929_evening | 2.31 GiB | 01:58:12 | harbour-cam static HLS / yt_dlp_piped |
| 4 | Speedcubing finals | speedcubing_finals_20260928 | 6.02 GiB | 02:04:41 | arena high-bitrate / yt_dlp_piped |
| 5 | Lo-fi radio overnight | lofi_radio_overnight_20260927 | 4.17 GiB | 08:00:03 | yt-dlp piped — default / yt_dlp_piped |
| 6 | VCT Pacific — playoffs day 1 | vct_pacific_playoffs_d1 | 812 MiB | 00:41:55 | arena high-bitrate / yt_dlp_piped |

Per-row fallback when the media is not served: **"Media not served on this
install — copy link instead."** Delete confirm: "Delete this recording? The file
is removed from disk — this cannot be undone."

### 10.5 Profiles

- **yt-dlp piped — default** — engine `yt_dlp_piped`, resolver `static`,
  retry `count (3 · delay 5.0)`, owner `kyros`
- **harbour-cam static HLS** — resolver `static`,
  retry `exit_code ([1] · delay 5.0)`, owner `obs-bot`
- **arena high-bitrate** — resolver `static`, retry `always`, owner `kyros`
- **workshop backup (no-record)** — recording off, retry `none`, owner `cloud-op`

Delete blocked: "In use by 2 autoruns and 1 session — delete those first."
Duplicate: "A resource with that name already exists." (verbatim API detail).

### 10.6 Plugins

- Engine **`yt_dlp_piped`** — "Pipes yt-dlp into ffmpeg; produces HLS segments."
  `origin: /srv/mirrorr/plugins/engines/yt_dlp_piped` ·
  `origin_hash: 6e57a1c4d9f2…` · badges: can_record, can_stream ·
  retry modes: `none | always | count (3 · 5.0) | exit_code ([1] · 5.0)`
- Resolver **`static`** — "Fixed-URL source; one URL per session."
  `origin: /srv/mirrorr/plugins/resolvers/static` · `origin_hash: f1c2b8e04a37…` ·
  `config_schema: {url: string (required), headers: object}`

Empty: "No plugins discovered on this install." Hash chip feedback: "Copied".

### 10.7 Import / export

Bundle file: `mirrorr-bundle-2026-09-30.json` — "Bundles carry profiles and
scheduled recordings — never media." Validation grid rows:
`harbour-cam static HLS — OK` · `arena high-bitrate — already imported (skip)` ·
`Speedcubing finals — engine not installed: yt_dlp_piped (hash 6e57a1c4…)` ·
`Lo-fi radio overnight — name conflict → "lofi_radio_overnight_2"` ·
`Speedrun WR attempts — profile missing`. Guard copy: "This bundle has 612 items
— the server accepts up to 500." Summary: "3 profiles created · 1 skipped ·
2 scheduled recordings created."

### 10.8 Settings

Users: `kyros` (admin, "Giulio"), `cloud-op` (admin, "Cloud"), `obs-bot` (user,
"OBS bridge"). Last-admin guard: "Cannot delete the last admin."
Clients: `n8n-bridge` (active, created 2026-08-14), `ios-shortcuts` (active,
2026-09-02), `grafana-poller` (revoked). Banner: "Programmatic access key — treat
like a password." One-time reveal: `mrr_live_9f2c…` in a mono copy field —
**"This key is shown once. Copy it now — it cannot be retrieved again."**
Account: "Changing your password signs you out everywhere."

### 10.9 Notifications, banners, toasts

Notification titles (API-shaped): `session 5: session.crashed` ·
`session 12: session.stopped` · `recording 3: recording.created`. Drawer empty:
"No notifications." API-key principal: "Notifications require a user session."
API-client banner: "API client session — polling every 10s" / "Created as a
system/API-client resource — it appears in no user's feed and fires no
notifications." Offline banner: "Cannot reach the recorder — retry."
WS fallback chip: "Live updates offline — polling."
Toasts: "Session 12 is recording." (info) · "Remux finished — recording 3 is
ready." (success) · "Cannot delete while remuxing." (error) ·
"Too many attempts — try again in a minute." (error, 429) ·
"Internal server error" (error, 500 detail verbatim).
Not-found: "No console at this address." + `label-caps` "/sessions/9999".

---

## 11. Assumptions resolved

Every judgement made on the implementer's behalf, as decisions. No open questions.

11.1 **`index-route` renders the Sessions list** (redirects to `/sessions`). The
routes inventory has both `index-route` and `sessions-route`; the per-view list
in the brief names only the sessions list, so there is no separate dashboard
surface. Nothing is invented.

11.2 **The status binding table carries nine keys** — the eight named in the
brief plus `active`. Part 3 §4 and §12.2 both define `active` ("Running",
green); rendering fewer statuses than the API sends is a defect. `unknown` is
the mandated fallback for unrecognized strings.

11.3 **Session display label is derived**: source tail from `resolver_config.url`
(host/path) + local start time; fallback "Session #<id>" when no URL is present.
`SessionResponse` has no name field; inventing one would violate the contract.

11.4 **Deepened indicator hues** `#05A257`, `#C9722F`, `#D01431` exist because
hard law 7 demands ≥3:1 for colour placements while `success` measures 2.17:1
and `warning` 2.37:1 on surface, and `danger`-with-white labels measure 4.38:1
(below 4.5 for 16px text). Exact ratios in 8.2. The base hues remain the token
law for anything that does not need the floor.

11.5 **Focus ring is two layers** (primary ring + `#141414` keyline, built in
the shadow layer) because the primary ring alone is 2.03:1 on worst-case acrylic
(8.2 rows 25–28). "≥3:1 against both the component and the page" is satisfied by
the pair, measured.

11.6 **Status chips are always the opaque chip variant** (hue indicator bar +
dot + icon + `#141414` word, `label-caps` 12px — licensed only on the opaque chip
variant). Acrylic chips keep `body-md` 16px labels and never carry status.

11.7 **Recordings has no primary button** — it creates nothing. "One primary per
view" is read as *at most* one; its loudest control is per-row "Open"
(secondary). Every other view has exactly one.

11.8 **Table headers are solid `secondary` bars with white `label-caps`** — the
only place 12px runs over data chrome, per "label-caps is licensed on opaque
chrome only (solid secondary toolbars…)". Form labels are `body-md` 16px/500,
not 12px.

11.9 **Numeric data cells use the sans with `tnum`** (vercel mechanism).
`JetBrains Mono` stays reserved for `label-caps` and code chips (hashes, keys,
slug chips) — the system reserves mono for machine readouts; a second mono role
would dilute it.

11.10 **Toasts sit at blur 40** (topmost surface gets the widest blur) and are
pinned away from the nav tier (bottom-right in A, bottom-left in B) so two 40s
never touch. Over a modal (24) the pair differs.

11.11 **Acrylic inputs appear only in modals or on bare media**; inside acrylic
cards (16) or opaque panels they use the opaque twin — keeping "two adjacent
acrylics never share a blur step" true while honouring the input recipe.

11.12 **Variant B is the bolder reading** (stated in §4): it inverts A's ambient
backdrop assumption and makes the product's media a permanent region. A is the
safe reading: conventional rail + topbar vocabulary.

11.13 **Mesh default hue fields** are glacier `#7FB2C8`, apricot `#E8B48A`, deep
teal `#0E3B43`, moss `#5C7A5E` over `#233038` — four distinct hue fields, no
purple/indigo (hard law 4 + anti-slop ban). If the operator disables the
backdrop, acrylic swaps to opaque twins and the console says so.

11.14 **Fonts load via stylesheet with system fallbacks**
(`"Plus Jakarta Sans", "Segoe UI", system-ui` / `"JetBrains Mono", ui-monospace`);
no new npm dependency. Offline installs render the fallback stack; the type
scale is unchanged.

11.15 **"Run now" is client-composed** `POST /sessions/` (API 13.10.8) and is
labelled as sugar; no endpoint is invented.

11.16 **Autoruns are one-shot**: no recurrence UI anywhere (no cron, no weekday
pickers). "Spent vs upcoming" is a client-side filter; the default view is All
(Oct 14 2026), so nothing is hidden until a status chip is picked.

11.17 **Remuxing/finalizing hide Delete** (absent, not disabled) per API 12.2;
a raced 409 still toasts "Cannot delete while remuxing."

11.18 **`content_url` is link-only** (API 13.11.5): download/open-in-new-tab and
a copy-link fallback; no scrubbing player is promised anywhere.

11.19 **Polling cadences are the spine's constants**: `LIST_BACKSTOP_MS` 30s,
`API_CLIENT_POLL_MS` 10s, `WS_FALLBACK_POLL_MS` 15s, `COUNTDOWN_TICK_MS` 10s,
`PAGE_SIZE` 50. No new tunables.

11.20 **WS outages are non-blocking**: chip + polling fallback (1s→30s backoff,
~12 attempts), never a modal; HTTP remains the source of truth; `deleted` frames
drop rows immediately (no `data` payload — API 13.10.13).

11.21 **Notifications come from two sources and are never joined on `id`** (API
13.10.2): WS feed is live, REST `/notifications/` is history.

11.22 **Destructive actions always confirm**, with the consequence in the copy —
autorun deletes say "It will also stop and delete any running recording it
started."

11.23 **422 rendering**: server `detail[]` entries map inline by `loc` (e.g.
`["body","engine_id"]` → "Field required" under the engine picker); the custom
422 shape (`detail` string + `errors[]`) renders the string at form top and maps
`errors[]` inline.

11.24 **Time renders local with a tz note** on every naive-UTC field
(`started_at`, `ended_at`, `start_time`, `end_time`, `created_at`,
`exported_at`); inputs carry "converts to UTC on save"; timezone-suffixed
strings are converted client-side before submit.

11.25 **The `frame`/`time`/`speed` fields of remux progress** render only when
present; without progress for ~10s the bar degrades to an indeterminate strip,
never a stuck 0%.

11.26 **Reduced-transparency fallbacks render solid `#FFFFFF`** with the same
luminous edge (not a resolved grey), keeping copy at 18.42:1; dark chrome stays
`#3A344E`.

11.27 **`whileInView` scroll-reveal is used zero times.** A data console earns
no scroll theatre; the only scroll-linked motion is the licensed parallax.

11.28 **Badge zero shows nothing** ("0" is noise); unread count drives
`aria-live` text only.

11.29 **Wall tiles (B) are irregular** — one 2×2 hero plus smaller tiles; the
grid is `auto-fit, minmax(min(14rem, 100%), 1fr)` with the hero spanning — so
"three equal cards" cannot occur in either variant. Elevation metaphors are
never mixed: glass floats, opaque panels sit flat with dividers only.

11.30 **Self-verification**: the file was written through `write`/`edit` only;
`wc -l` is unavailable in this agent's toolset (read/write/edit/codebase-memory
only), so the line count reported at handoff comes from the read-back of the
file (the read tool's final line number), which is the same measure.

---
