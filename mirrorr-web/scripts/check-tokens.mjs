#!/usr/bin/env bun
/**
 * check-tokens — assert src/styles/tokens.css declares every token of
 * docs/console-design-spec.md §1.2 ("CSS custom properties (normative
 * implementation values)").
 *
 * The spec block is normative and byte-for-byte bindable, so the gate is two
 * layers:
 *   1. PRESENT  — every §1.2 name exists in tokens.css.
 *   2. EQUIVALENT / CONTAINS — the value-bearing tokens carry the §1.2 value
 *      (whitespace-insensitive compare: `rgba(255, 255, 255, .55)` and
 *      `rgba(255,255,255,.55)` both normalise to the same string, so a
 *      formatter cannot fail the gate but a re-derived number can). The two
 *      recipe tokens (--luminous-edge, --focus-ring) are checked by the
 *      substrings §1.2 requires rather than by exact string, because §1.2
 *      itself spells them across lines.
 *
 * A missing or drifted token is a token-layer defect — fix tokens.css (or the
 * spec), never this script. Exit 0 = §1.2 honoured; exit 1 = defects printed.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url))

/** §1.2 whitespace-and-case-insensitive canonicalisation. */
const norm = (value) => value.replace(/\s+/g, "").toLowerCase()

/** §1.2 names whose exact value the layer must carry. */
const EQUIVALENT = {
  // ---- colour: system hues (§1.2) ----
  "--color-primary": "#1856FF",
  "--color-secondary": "#3A344E",
  "--color-success": "#07CA6B",
  "--color-warning": "#E89558",
  "--color-danger": "#EA2143",
  "--color-surface": "#FFFFFF",
  "--color-text": "#141414",

  // ---- colour: derived (§1.2 rationale block) ----
  "--color-text-muted": "#6E6E6E",
  "--color-success-deep": "#05A257",
  "--color-warning-deep": "#C9722F",
  "--color-danger-deep": "#D01431",

  // ---- colour: glass mix + edges (acrylic alphas 0.55 / 0.64 / 0.72) ----
  "--glass-chip": "rgba(255, 255, 255, 0.55)",
  "--glass-card": "rgba(255, 255, 255, 0.64)",
  "--glass-modal": "rgba(255, 255, 255, 0.72)",
  "--glass-nav": "rgba(255, 255, 255, 0.55)",
  "--glass-tint": "rgba(24, 86, 255, 0.08)",
  "--glass-border": "rgba(255, 255, 255, 0.28)",
  "--edge-near": "rgba(255, 255, 255, 0.35)",
  "--edge-far": "rgba(20, 20, 20, 0.06)",
  "--glass-shadow":
    "0 24px 48px -12px rgba(24, 86, 255, 0.18), 0 8px 16px -8px rgba(20, 20, 20, 0.12)",

  // ---- blur ladder (8 / 16 / 24 / 40) ----
  "--blur-chip": "8px",
  "--blur-card": "16px",
  "--blur-modal": "24px",
  "--blur-nav": "40px",

  // ---- scrim ladder (always rgba(20,20,20,a)) ----
  "--scrim-45": "rgba(20, 20, 20, 0.45)",
  "--scrim-55": "rgba(20, 20, 20, 0.55)",
  "--scrim-65": "rgba(20, 20, 20, 0.65)",
  "--scrim-75": "rgba(20, 20, 20, 0.75)",

  // ---- type: sans + mono roles ----
  "--font-sans": '"Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
  "--font-mono": '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
  "--text-h1": "3rem",
  "--text-h2": "clamp(1.5rem, 1.25rem + 1vw, 2rem)",
  "--text-h3": "clamp(1.125rem, 1.0625rem + 0.3vw, 1.5rem)",
  "--text-body": "1rem",
  "--text-label": "0.75rem",
  "--tracking-h1": "-0.02em",
  "--tracking-label": "0.08em",
  "--weight-read": "400",
  "--weight-ui": "500",
  "--weight-announce": "700",
  "--measure": "68ch",

  // ---- radius (closed 0 / 4 / 8) ----
  "--radius-none": "0px",
  "--radius-sm": "4px",
  "--radius-md": "8px",

  // ---- spacing (4-point grid) ----
  "--space-sm": "8px",
  "--space-md": "16px",
  "--space-lg": "32px",
  "--space-xl": "64px",
  "--gutter": "24px",

  // ---- motion (four pinned tokens) ----
  "--motion-micro": "spring(400 / 30)",
  "--motion-ui": "spring(300 / 24)",
  "--motion-page": "spring(350 / 35)",
  "--motion-tween-enter": "0.2s ease-out",
}

/** §1.2 recipe tokens: exact strings are spelled across lines, so check parts. */
const CONTAINS = {
  "--luminous-edge": ["inset", "1px", "1px", "0", "var(--edge-near)", "0", "-1px", "0", "var(--edge-far)"],
  "--focus-ring": [
    "0 0 0 2px var(--color-surface)",
    "0 0 0 4px var(--color-primary)",
    "0 0 0 5px var(--color-text)",
  ],
}

const NAMES = [...Object.keys(EQUIVALENT), ...Object.keys(CONTAINS)]

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
const missing = NAMES.filter((name) => !declared.has(name))
const drifted = []

for (const [name, expected] of Object.entries(EQUIVALENT)) {
  const actual = declared.get(name)
  if (actual !== undefined && norm(actual) !== norm(expected)) {
    drifted.push({ name, expected, actual })
  }
}
for (const [name, parts] of Object.entries(CONTAINS)) {
  const actual = declared.get(name)
  if (actual !== undefined && !parts.every((part) => norm(actual).includes(norm(part)))) {
    drifted.push({ name, expected: parts.join(" … "), actual })
  }
}

if (missing.length > 0 || drifted.length > 0) {
  console.error(
    `[check-tokens] FAIL — ${missing.length} missing / ${drifted.length} drifted design-spec §1.2 token(s):`,
  )
  for (const name of missing) console.error(`  missing  ${name}`)
  for (const { name, expected, actual } of drifted) {
    console.error(`  drifted  ${name}`)
    console.error(`             spec:  ${expected}`)
    console.error(`             sheet: ${actual}`)
  }
  console.error("[check-tokens] fix src/styles/tokens.css (or the spec) — do not relax this gate.")
  process.exit(1)
}

console.log(
  `[check-tokens] ok — ${NAMES.length} design-spec §1.2 tokens present in tokens.css ` +
    `(${Object.keys(EQUIVALENT).length} value-checked, ${Object.keys(CONTAINS).length} recipe-checked)`,
)
