#!/usr/bin/env bun
/**
 * check-tokens — assert src/ui/styles/tokens.css is the pinned, single source
 * of the "Control Room" token layer, and that nothing in the CSS layer
 * references a token that does not exist.
 *
 * Source of truth: tokens.css itself. The glass-console spec that used to own
 * this gate (docs/console-design-spec.md §1.2) was superseded when the client
 * was rebuilt on the dark Control Room direction — see the working-tree rewrite
 * of Oct 2026. The gate is therefore three layers:
 *
 *   1. PRESENT    — every pinned name exists in tokens.css.
 *   2. EQUIVALENT — every pinned name carries its pinned value (whitespace- and
 *                   case-insensitive, so a formatter cannot fail the gate but a
 *                   re-derived number can).
 *   3. DEFINED    — every `var(--x)` used in the authored CSS layer *or in the
 *                   `var(--…)` arbitrary values that now carry the styling
 *                   inside TS/TSX class strings* resolves to a token declared in
 *                   tokens.css, in the video.js skin's own token layer (see
 *                   SKIN_STYLES — the skin is a port that carries a `--media-*`
 *                   namespace of its own), or a custom property published per
 *                   element at runtime (see RUNTIME_PROPS). A reference without a
 *                   fallback that resolves to nothing is a rendering bug (the
 *                   declaration is dropped silently), so it fails the gate.
 *
 * A missing, drifted, or dangling token is a token-layer defect — fix
 * tokens.css (or the consuming CSS), never relax this script.
 * Exit 0 = the layer is pinned and closed; exit 1 = defects printed.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/ui/styles/tokens.css", import.meta.url))
const CSS_DIR = new URL("../src/ui/styles/", import.meta.url)
const CSS_FILES = ["base.css", "components.css", "layout.css", "fonts.css", "tailwind.css"]
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url))

/**
 * Custom properties published per element at runtime rather than declared in
 * tokens.css, so a bare `var(--x)` for one of them is legitimate. Keep this list
 * tiny and justified — each entry must name the component that publishes it.
 */
const RUNTIME_PROPS = new Set([
  "--chip-hue", // set by StatusChip/StatusDot `[--chip-hue:var(--…)]` tone variants
])

/** Pinned token values. Any change here is a deliberate token-layer decision. */
const PINNED = {
  // ---- canvas & surfaces ----
  "--bg": "#0a0a0c",
  "--bg-sunken": "#070708",
  "--surface-1": "#121216",
  "--surface-2": "#18181d",
  "--surface-3": "#1f1f26",
  "--surface-4": "#282830",
  "--surface-hover": "#1d1d23",
  "--overlay-scrim": "rgba(4, 4, 6, 0.66)",

  // ---- borders ----
  "--border": "#2a2a32",
  "--border-subtle": "#202027",
  "--border-strong": "#3a3a45",

  // ---- text tiers (all three clear 4.5:1 — see check-contrast.mjs) ----
  "--text": "#ededf0",
  "--text-muted": "#9b9ba6",
  "--text-dim": "#909099",
  "--text-faint": "#4d4d57",
  "--text-inverse": "#0a0a0c",

  // ---- accent (signal green) ----
  "--accent": "#00e676",
  "--accent-hover": "#57ef9e",
  "--accent-press": "#00b85c",
  "--accent-ink": "#00220e",
  "--accent-dim": "rgba(0, 230, 118, 0.14)",
  "--accent-line": "rgba(0, 230, 118, 0.4)",
  "--selection-bg": "rgba(0, 230, 118, 0.38)",

  // ---- status hues ----
  "--success": "#3fb950",
  "--success-ink": "#06240c",
  "--success-dim": "rgba(63, 185, 80, 0.14)",
  "--warning": "#e3b341",
  "--warning-ink": "#241a04",
  "--warning-dim": "rgba(227, 179, 65, 0.14)",
  "--danger": "#f85149",
  "--danger-ink": "#2a0705",
  "--danger-dim": "rgba(248, 81, 73, 0.15)",
  "--info": "#58a6ff",
  "--info-dim": "rgba(88, 166, 255, 0.14)",
  "--secondary": "#a371f7",
  "--secondary-ink": "#170a2e",
  "--secondary-dim": "rgba(163, 113, 247, 0.15)",
  "--neutral": "#8b949e",
  "--neutral-dim": "rgba(139, 148, 158, 0.14)",

  // ---- radii ----
  "--r-xs": "3px",
  "--r-sm": "5px",
  "--r-md": "8px",
  "--r-lg": "12px",
  "--r-xl": "16px",
  "--r-full": "999px",

  // ---- space ----
  "--s-1": "4px",
  "--s-2": "8px",
  "--s-3": "12px",
  "--s-4": "16px",
  "--s-5": "20px",
  "--s-6": "24px",
  "--s-7": "28px",
  "--s-8": "32px",
  "--s-10": "40px",
  "--s-12": "48px",
  "--s-16": "64px",

  // ---- type ----
  "--font-ui": '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  "--font-mono": '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  "--fs-2xs": "10px",
  "--fs-xs": "11px",
  "--fs-sm": "12px",
  "--fs-base": "13px",
  "--fs-md": "14px",
  "--fs-lg": "16px",
  "--fs-xl": "19px",
  "--fs-2xl": "24px",
  "--fs-3xl": "30px",
  "--lh-tight": "1.2",
  "--lh-snug": "1.35",
  "--lh-normal": "1.55",
  "--fw-regular": "400",
  "--fw-medium": "500",
  "--fw-semibold": "600",
  "--fw-bold": "700",

  // ---- elevation ----
  "--shadow-xs": "0 1px 1px rgba(0, 0, 0, 0.35)",
  "--shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.45)",
  "--shadow-md": "0 8px 24px -6px rgba(0, 0, 0, 0.6)",
  "--shadow-lg": "0 24px 60px -12px rgba(0, 0, 0, 0.7)",
  "--ring": "0 0 0 2px var(--bg), 0 0 0 4px var(--accent)",

  // ---- layout ----
  "--sidebar-w": "236px",
  "--sidebar-rail-w": "64px",
  "--topbar-h": "56px",
  "--content-max": "1400px",
  "--bottomnav-h": "56px",

  // ---- motion ----
  "--dur-instant": "80ms",
  "--dur-fast": "140ms",
  "--dur-med": "220ms",
  "--dur-slow": "360ms",
  "--ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--ease-in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
  "--ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",

  // ---- z-index ladder ----
  "--z-sticky": "20",
  "--z-topbar": "30",
  "--z-sidebar": "40",
  "--z-drawer": "60",
  "--z-modal": "70",
  "--z-popover": "75",
  "--z-toast": "90",
}

const norm = (value) => value.replace(/\s+/g, "").toLowerCase()

/**
 * The skin's own stylesheets, merged into their own map rather than `declared`:
 * a console token must be declared in tokens.css, never merely in the skin.
 */
const SKIN_STYLES_DIR = fileURLToPath(new URL("../src/ui/components/videojs/styles/", import.meta.url))

function parseDeclarations(css) {
  const values = new Map()
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = match[2].replace(/\/\*[\s\S]*?\*\//g, "").trim()
    if (value !== "") values.set(match[1], value)
  }
  return values
}

/** Authored `.ts`/`.tsx` under src/ — where the utility class strings now live. */
function* walkSource(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkSource(path)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) yield path
  }
}

let tokensCss
try {
  tokensCss = readFileSync(TOKENS_FILE, "utf8")
} catch {
  console.error(`[check-tokens] FAIL — cannot read ${TOKENS_FILE}`)
  process.exit(1)
}

const declared = parseDeclarations(tokensCss)
const missing = Object.keys(PINNED).filter((name) => !declared.has(name))
const drifted = []
for (const [name, expected] of Object.entries(PINNED)) {
  const actual = declared.get(name)
  if (actual !== undefined && norm(actual) !== norm(expected)) {
    drifted.push({ name, expected, actual })
  }
}

/**
 * The video.js skin is a port with a token namespace of its own (`--media-*`),
 * declared across its stylesheets and scoped to `.media-skin` — never in
 * tokens.css, which owns the console's layer. The console's player chrome in
 * components.css consumes that namespace on purpose, so a `--media-*` reference
 * resolves here too. A typo still fails: only names the skin really declares
 * resolve.
 */
const skinDeclared = new Map()
for (const entry of readdirSync(SKIN_STYLES_DIR, { recursive: true })) {
  const name = String(entry)
  if (!name.endsWith(".css")) continue
  for (const [token, value] of parseDeclarations(readFileSync(join(SKIN_STYLES_DIR, name), "utf8"))) {
    skinDeclared.set(token, value)
  }
}

const dangling = []

// `var(--x, fallback)` is fine when --x is absent; a bare `var(--x)` is not.
function collectDangling(label, text, local) {
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const [, name, terminator] = match
    if (terminator === ",") continue
    if (declared.has(name) || local.has(name) || skinDeclared.has(name) || RUNTIME_PROPS.has(name)) continue
    dangling.push(`${label}: ${name}`)
  }
}

for (const file of CSS_FILES) {
  let css
  try {
    css = readFileSync(new URL(file, CSS_DIR), "utf8")
  } catch {
    continue
  }
  collectDangling(file, css, parseDeclarations(css))
}

// The styling now lives in `var(--…)` arbitrary values inside class strings, so
// scan the sources too. No declaration parsing here: a `--x:…` inside an
// arbitrary value is not a declaration — runtime props are listed explicitly.
const sources = [...walkSource(SRC_DIR)]
  .map((file) => [relative(process.cwd(), file), readFileSync(file, "utf8")])
  .filter(([, text]) => text.includes("var(--"))
for (const [label, text] of sources) collectDangling(label, text, new Map())

if (missing.length > 0 || drifted.length > 0 || dangling.length > 0) {
  console.error(
    `[check-tokens] FAIL — ${missing.length} missing / ${drifted.length} drifted / ${dangling.length} dangling token(s):`,
  )
  for (const name of missing) console.error(`  missing   ${name}`)
  for (const { name, expected, actual } of drifted) {
    console.error(`  drifted   ${name}`)
    console.error(`             pinned: ${expected}`)
    console.error(`             sheet:  ${actual}`)
  }
  for (const ref of dangling) console.error(`  dangling  ${ref} — referenced with no fallback and never declared`)
  console.error("[check-tokens] fix tokens.css (or the consuming CSS) — do not relax this gate.")
  process.exit(1)
}

console.log(
  `[check-tokens] ok — ${Object.keys(PINNED).length} pinned tokens present and value-checked, ` +
    `${skinDeclared.size} skin-layer tokens resolved, ` +
    `no dangling var() references in ${CSS_FILES.length} stylesheets or ${sources.length} source files`,
)
