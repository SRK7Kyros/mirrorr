#!/usr/bin/env bun
/**
 * check-contrast — recompute WCAG 2.x contrast for every pair listed in
 * design spec §7 (docs/web-frontend-design-spec.md §7) against the live
 * tokens in src/styles/tokens.css.
 *
 * Method: WCAG 2.x piecewise relative luminance; alpha tints composited in
 * 8-bit over their backdrop exactly as the browser paints them (§2: status
 * tints sit over bg-raised).
 *
 * Floors: §7 states the general rule (text ≥4.5:1, non-text ≥3:1) plus a
 * per-pair table. That table carries small derivation drift on a few rows
 * (checked against the exact §1 hexes: #09090b on #ef4444 computes 5.29:1
 * vs listed 5.5; unknown-chip tint computes 6.2:1 vs listed 6.6; the amber
 * dot computes 9.3:1 vs listed 12.0 — while the remaining rows land within
 * 0.1:1 of their listed value). So:
 *   - text rows     → floor = max(4.5, listed − 0.5)
 *   - graphics rows → floor = 3.0 (§7 verdict "≥3:1 non-text")
 * and every computed value is printed next to its listed one so drift stays
 * visible. A pair passes when computed, rounded to §7's 0.1:1 precision,
 * meets its floor. Exits 1 on any failure or unreadable tokens.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url))

const TEXT_MIN = 4.5
const GRAPHICS_MIN = 3.0
const SLACK = 0.5

/** kind: "text" → §7 body floor; "graphics" → §7 non-text floor. */
const PAIRS = [
  { label: "body/headings", fg: "--color-text-primary", bg: "--color-bg-base", kind: "text", listed: 19.1 },
  { label: "card/table text", fg: "--color-text-primary", bg: "--color-bg-raised", kind: "text", listed: 17.2 },
  { label: "secondary text", fg: "--color-text-secondary", bg: "--color-bg-base", kind: "text", listed: 7.8 },
  { label: "secondary on card", fg: "--color-text-secondary", bg: "--color-bg-raised", kind: "text", listed: 7.1 },
  { label: "muted meta on card", fg: "--color-text-muted", bg: "--color-bg-raised", kind: "text", listed: 5.0 },
  { label: "links/focus", fg: "--color-accent-text", bg: "--color-bg-base", kind: "text", listed: 8.8 },
  { label: "links on card", fg: "--color-accent-text", bg: "--color-bg-raised", kind: "text", listed: 8.0 },
  { label: "primary button", fg: "--color-text-primary", bg: "--color-primary", kind: "text", listed: 6.4 },
  { label: "button hover/secondary", fg: "--color-text-primary", bg: "--color-secondary", kind: "text", listed: 8.5 },
  { label: "danger button/badge text", fg: "--color-text-inverse", bg: "--color-danger", kind: "text", listed: 5.5 },
  { label: "error text", fg: "--error-fg", bg: "--color-bg-base", kind: "text", listed: 7.2 },
  { label: "scheduled chip", fg: "--status-scheduled-fg", tint: "--status-scheduled-tint", kind: "text", listed: 7.4 },
  { label: "active/completed chip", fg: "--status-active-fg", tint: "--status-active-tint", kind: "text", listed: 7.9 },
  { label: "terminating chip", fg: "--status-terminating-fg", tint: "--status-terminating-tint", kind: "text", listed: 8.8 },
  { label: "recording/failed chip", fg: "--status-recording-fg", tint: "--status-recording-tint", kind: "text", listed: 5.9 },
  { label: "remuxing/finalizing chip", fg: "--status-remuxing-fg", tint: "--status-remuxing-tint", kind: "text", listed: 9.1 },
  { label: "unknown chip", fg: "--status-unknown-fg", tint: "--status-unknown-tint", kind: "text", listed: 6.6 },
  { label: "muted on base", fg: "--color-text-muted", bg: "--color-bg-base", kind: "text", listed: 5.5 },
  { label: "recording dot (graphic)", fg: "--status-recording-dot", bg: "--color-bg-base", kind: "graphics", listed: 5.5 },
  { label: "success dot (graphic)", fg: "--status-active-dot", bg: "--color-bg-base", kind: "graphics", listed: 7.8 },
  { label: "warning dot (graphic)", fg: "--status-terminating-dot", bg: "--color-bg-base", kind: "graphics", listed: 12.0 },
  { label: "focus ring (graphic)", fg: "--focus-ring-color", bg: "--color-bg-base", kind: "graphics", listed: 3.0 },
]

function parseDeclarations(css) {
  const values = new Map()
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = match[2].replace(/\/\*[\s\S]*?\*\//g, "").trim()
    if (value !== "") values.set(match[1], value)
  }
  return values
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex !== null) {
    let digits = hex[1]
    if (digits.length === 3) {
      digits = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
    }
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    }
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  )
  if (rgba !== null) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  throw new Error(`unsupported color value: ${value}`)
}

/** 8-bit alpha composite, matching how the browser paints tint fills. */
function composite(fg, bg) {
  return {
    r: Math.round(fg.a * fg.r + (1 - fg.a) * bg.r),
    g: Math.round(fg.a * fg.g + (1 - fg.a) * bg.g),
    b: Math.round(fg.a * fg.b + (1 - fg.a) * bg.b),
    a: 1,
  }
}

function channelLuminance(channel) {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrast(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

function resolveColor(name, vars) {
  const raw = vars.get(name)
  if (raw === undefined) throw new Error(`token not found in tokens.css: ${name}`)
  return parseColor(raw)
}

let css
try {
  css = readFileSync(TOKENS_FILE, "utf8")
} catch {
  console.error(`[check-contrast] FAIL — cannot read ${TOKENS_FILE}`)
  process.exit(1)
}

const vars = parseDeclarations(css)
const failures = []

console.log("[check-contrast] pair                              computed  §7 listed   floor")
for (const pair of PAIRS) {
  let ratio
  try {
    const fg = resolveColor(pair.fg, vars)
    const bg =
      pair.tint === undefined
        ? resolveColor(pair.bg, vars)
        : composite(resolveColor(pair.tint, vars), resolveColor(pair.bg ?? "--color-bg-raised", vars))
    ratio = contrast(fg, bg)
  } catch (err) {
    console.error(`[check-contrast] FAIL — ${pair.label}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const floor =
    pair.kind === "graphics"
      ? GRAPHICS_MIN
      : Math.max(TEXT_MIN, pair.listed - SLACK)
  const rounded = Math.round(ratio * 10) / 10
  const pass = rounded >= floor
  const drift = Math.abs(ratio - pair.listed) > 0.05 ? " !" : ""
  console.log(
    `[check-contrast] ${pair.label.padEnd(32)} ${ratio.toFixed(2).padStart(6)}:1 ` +
      `${String(pair.listed).padStart(6)}:1 ${floor.toFixed(1).padStart(6)}:1  ${pass ? "ok" : "FAIL"}${drift}`,
  )
  if (!pass) failures.push(`${pair.label} — computed ${ratio.toFixed(2)}:1, floor ${floor.toFixed(1)}:1`)
}

if (failures.length > 0) {
  console.error(`[check-contrast] FAIL — ${failures.length} pair(s) below floor:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(
  `[check-contrast] ok — ${PAIRS.length} §7 pairs meet their floors (! = §7 table drift, informational)`,
)
