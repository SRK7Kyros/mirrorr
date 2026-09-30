#!/usr/bin/env bun
/**
 * check-tokens — assert src/styles/tokens.css declares every design-spec §1
 * token the console depends on. Normative source:
 * docs/web-frontend-design-spec.md §1 (Token YAML); REQUIRED below maps each
 * §1 YAML key to the CSS custom property tokens.css binds it to (the mapping
 * is manual by design — the YAML is the contract, tokens.css is the binding).
 *
 * Exit 0 = sheet complete; exit 1 = list of missing tokens printed.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url))

const STATUS_KEYS = [
  "scheduled",
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
  "completed",
  "failed",
  "unknown",
]

const COLOR_GROUPS = [
  ["--color-primary", "--color-secondary", "--color-success", "--color-warning", "--color-danger", "--color-surface", "--color-text", "--color-neutral"],
  ["--color-bg-base", "--color-bg-panel", "--color-bg-raised", "--color-fill-hover", "--color-fill-active", "--color-overlay-backdrop"],
  ["--color-border-subtle", "--color-border-standard", "--color-border-strong"],
  ["--color-text-primary", "--color-text-secondary", "--color-text-muted", "--color-text-inverse"],
  ["--color-accent-fill", "--color-accent-fill-hover", "--color-accent-text", "--color-accent-text-hover", "--color-focus-ring"],
]

const TYPE_SCALE = ["--text-12", "--text-14", "--text-16", "--text-20", "--text-24", "--text-32"]
const WEIGHTS = ["--weight-400", "--weight-500", "--weight-600"]

const TYPE_ROLES = [
  "--role-h1-size", "--role-h1-weight", "--role-h1-lh", "--role-h1-tracking",
  "--role-h2-size", "--role-h2-weight", "--role-h2-lh", "--role-h2-tracking",
  "--role-h3-size", "--role-h3-weight", "--role-h3-lh", "--role-h3-tracking",
  "--role-body-md-size", "--role-body-md-weight", "--role-body-md-lh",
  "--role-body-size", "--role-body-weight", "--role-body-lh",
  "--role-body-strong-weight",
  "--role-label-caps-size", "--role-label-caps-weight", "--role-label-caps-lh", "--role-label-caps-tracking",
  "--role-meta-size", "--role-meta-weight", "--role-meta-lh",
  "--role-mono-size", "--role-mono-weight", "--role-mono-lh",
  "--role-mono-inline-size", "--role-mono-inline-weight", "--role-mono-inline-lh",
]

const RADIUS_SCALE = ["--radius-sm", "--radius-md", "--radius-full"]
const RADIUS_ELEMENTS = [
  "--radius-chip", "--radius-badge", "--radius-button", "--radius-input",
  "--radius-select", "--radius-switch-track", "--radius-well", "--radius-card",
  "--radius-menu", "--radius-dialog", "--radius-sheet", "--radius-toast",
  "--radius-drawer", "--radius-fab", "--radius-row",
]

const SPACING = [
  "--space-hair", "--space-xs", "--space-sm", "--space-smd", "--space-md",
  "--space-lg", "--space-xl", "--space-xxl",
  "--space-page-pad-desktop", "--space-page-pad-compact",
  "--space-section-gap-desktop", "--space-section-gap-compact",
  "--space-card-pad", "--space-table-cell-pad-inline",
]

const ROW_HEIGHTS = ["--row-h-desktop", "--table-row-h", "--card-min-h-compact"]

const COMPONENTS = [
  "--focus-ring-width", "--focus-ring-color", "--focus-ring-offset",
  "--button-h", "--input-h", "--select-trigger-h", "--chip-h", "--badge-h",
  "--switch-track-w", "--switch-track-h",
  "--topbar-h", "--sidebar-w", "--appbar-h", "--tabbar-h", "--fab-size",
  "--dialog-w", "--dialog-w-wizard", "--toast-w", "--drawer-w",
]

const REQUIRED = [
  ...COLOR_GROUPS.flat(),
  ...STATUS_KEYS.flatMap((key) => [
    `--status-${key}-dot`,
    `--status-${key}-fg`,
    `--status-${key}-tint`,
  ]),
  "--font-sans",
  "--font-mono",
  ...TYPE_SCALE,
  ...WEIGHTS,
  "--features-mono",
  ...TYPE_ROLES,
  ...RADIUS_SCALE,
  ...RADIUS_ELEMENTS,
  ...SPACING,
  ...ROW_HEIGHTS,
  ...COMPONENTS,
]

function parseDeclarations(css) {
  const values = new Map()
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = match[2].replace(/\/\*[\s\S]*?\*\//g, "").trim()
    if (value !== "") values.set(match[1], value)
  }
  return values
}

let css
try {
  css = readFileSync(TOKENS_FILE, "utf8")
} catch {
  console.error(`[check-tokens] FAIL — cannot read ${TOKENS_FILE}`)
  process.exit(1)
}

const declared = parseDeclarations(css)
const missing = REQUIRED.filter((name) => !declared.has(name))

if (missing.length > 0) {
  console.error(`[check-tokens] FAIL — ${missing.length} design-spec §1 token(s) missing from tokens.css:`)
  for (const name of missing) console.error(`  ${name}`)
  process.exit(1)
}

console.log(`[check-tokens] ok — ${REQUIRED.length} design-spec §1 tokens present in tokens.css`)
