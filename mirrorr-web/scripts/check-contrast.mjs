#!/usr/bin/env bun
/**
 * check-contrast — recompute WCAG 2.x contrast for every pair in
 * docs/console-design-spec.md §8.2 against the values actually declared in
 * src/styles/tokens.css.
 *
 * Method (§8.1): WCAG 2.x piecewise sRGB relative luminance,
 * (L1 + 0.05) / (L2 + 0.05). Alpha layers are composited in 8-bit over the
 * ground they sit on, exactly as the browser paints them:
 *   - acrylic worst case = tier white alpha composited over near-black media,
 *     then --glass-tint over that (rows 2-4, 12, 26-27);
 *   - scrim worst case   = scrim composited over pure-white media (rows 8-11);
 *   - alpha text         = the fg alpha composited over its own background
 *     (rows 12, 23).
 *
 * Gates per row come from §8.2's own "Use / verdict" column:
 *   min  — must meet the stated floor (text 4.5, large text 3.0, non-text 3.0);
 *   max  — §8.2 states the pair must stay *under* a ceiling (row 20 danger fill
 *          carrying body text is banned; row 26's primary ring alone does not
 *          clear 3:1 and is carried by the keyline) — a regression here would
 *          invalidate the rationale, so it fails the gate.
 * Row 12's nav inactive label is normal-size persistent navigation text, so it
 * is gated at 4.5 like every other text row: WCAG 1.4.3 covers every
 * persistent nav label, and the earlier "dim = decorative, hover-recoverable"
 * reading was a genuine miss (the 80% tint computed 3.99:1). The label tint is
 * now 90% (`color-mix(in srgb, var(--color-text) 90%, transparent)` in
 * ui.css), which computes ~4.60:1 against the worst-case acrylic ground.
 * Every row prints its computed ratio next to §8.2's claim; drift > 0.05 is
 * flagged with "!" (informational).
 *
 * Exit 1 if any gated row misses its floor/ceiling or tokens.css is unreadable.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url))

/** §8.1 grounds. */
const BLACK_MEDIA = { r: 0, g: 0, b: 0, a: 1 }
const WHITE_MEDIA = { r: 255, g: 255, b: 255, a: 1 }

/** fg/bg descriptors, resolved against tokens.css. */
const tok = (name) => ({ kind: "token", name })
const alphaText = (name, alpha) => ({ kind: "alpha-text", name, alpha })
const acrylic = (tier) => ({ kind: "acrylic", tier })
const scrim = (name) => ({ kind: "scrim", name })

/**
 * §8.2 rows 1-28, in order, with the spec's own claim and gate.
 * floor/ceiling values follow §8.2's "Use / verdict" column.
 */
const PAIRS = [
  { n: 1, label: "body copy", fg: tok("--color-text"), bg: tok("--color-surface"), claim: 18.42, gate: "min", floor: 4.5 },
  { n: 2, label: "16px label on chip/nav acrylic", fg: tok("--color-text"), bg: acrylic("--glass-chip"), claim: 5.19, gate: "min", floor: 4.5 },
  { n: 3, label: "16px label on card acrylic", fg: tok("--color-text"), bg: acrylic("--glass-card"), claim: 6.79, gate: "min", floor: 4.5 },
  { n: 4, label: "16px label on modal acrylic", fg: tok("--color-text"), bg: acrylic("--glass-modal"), claim: 8.49, gate: "min", floor: 4.5 },
  { n: 5, label: "16px label on primary button", fg: tok("--color-surface"), bg: tok("--color-primary"), claim: 5.51, gate: "min", floor: 4.5 },
  { n: 6, label: "body link on surface", fg: tok("--color-primary"), bg: tok("--color-surface"), claim: 5.51, gate: "min", floor: 4.5 },
  { n: 7, label: "12px label-caps on dark chrome", fg: tok("--color-surface"), bg: tok("--color-secondary"), claim: 11.79, gate: "min", floor: 4.5 },
  { n: 8, label: "large copy on scrim-45 over media", fg: tok("--color-surface"), bg: scrim("--scrim-45"), claim: 3.0, gate: "min", floor: 3.0 },
  { n: 9, label: "large copy on scrim-55 over media", fg: tok("--color-surface"), bg: scrim("--scrim-55"), claim: 4.06, gate: "min", floor: 3.0 },
  { n: 10, label: "normal copy on scrim-65 over media", fg: tok("--color-surface"), bg: scrim("--scrim-65"), claim: 5.74, gate: "min", floor: 4.5 },
  { n: 11, label: "dense copy on scrim-75 over media", fg: tok("--color-surface"), bg: scrim("--scrim-75"), claim: 8.19, gate: "min", floor: 4.5 },
  { n: 12, label: "nav inactive label @90% on acrylic", fg: alphaText("--color-text", 0.9), bg: acrylic("--glass-chip"), claim: 4.59, gate: "min", floor: 4.5 },
  { n: 13, label: "success-deep indicator", fg: tok("--color-success-deep"), bg: tok("--color-surface"), claim: 3.33, gate: "min", floor: 3.0 },
  { n: 14, label: "warning-deep indicator", fg: tok("--color-warning-deep"), bg: tok("--color-surface"), claim: 3.54, gate: "min", floor: 3.0 },
  { n: 15, label: "danger indicator", fg: tok("--color-danger"), bg: tok("--color-surface"), claim: 4.38, gate: "min", floor: 3.0 },
  { n: 16, label: "primary indicator", fg: tok("--color-primary"), bg: tok("--color-surface"), claim: 5.51, gate: "min", floor: 3.0 },
  { n: 17, label: "secondary indicator", fg: tok("--color-secondary"), bg: tok("--color-surface"), claim: 11.79, gate: "min", floor: 3.0 },
  { n: 18, label: "text on success fill", fg: tok("--color-text"), bg: tok("--color-success"), claim: 8.48, gate: "min", floor: 4.5 },
  { n: 19, label: "text on warning fill", fg: tok("--color-text"), bg: tok("--color-warning"), claim: 7.78, gate: "min", floor: 4.5 },
  { n: 20, label: "text on danger fill (BANNED)", fg: tok("--color-text"), bg: tok("--color-danger"), claim: 4.21, gate: "max", ceiling: 4.5 },
  { n: 21, label: "destructive label on danger-deep", fg: tok("--color-surface"), bg: tok("--color-danger-deep"), claim: 5.49, gate: "min", floor: 4.5 },
  { n: 22, label: "helper/placeholder", fg: tok("--color-text-muted"), bg: tok("--color-surface"), claim: 5.1, gate: "min", floor: 4.5 },
  { n: 23, label: "disabled label @55% (1.4.3 exception)", fg: alphaText("--color-text", 0.55), bg: tok("--color-surface"), claim: 4.06, gate: "info" },
  { n: 24, label: "error copy", fg: tok("--color-text"), bg: tok("--color-surface"), claim: 18.42, gate: "min", floor: 4.5 },
  { n: 25, label: "focus ring primary vs surface", fg: tok("--color-primary"), bg: tok("--color-surface"), claim: 5.51, gate: "min", floor: 3.0 },
  { n: 26, label: "focus ring primary vs acrylic 0.64", fg: tok("--color-primary"), bg: acrylic("--glass-card"), claim: 2.03, gate: "max", ceiling: 3.0 },
  { n: 27, label: "focus ring keyline vs acrylic 0.64", fg: tok("--color-text"), bg: acrylic("--glass-card"), claim: 6.79, gate: "min", floor: 3.0 },
  { n: 28, label: "focus ring keyline vs surface", fg: tok("--color-text"), bg: tok("--color-surface"), claim: 18.42, gate: "min", floor: 3.0 },
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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

let css
try {
  css = readFileSync(TOKENS_FILE, "utf8")
} catch {
  console.error(`[check-contrast] FAIL — cannot read ${TOKENS_FILE}`)
  process.exit(1)
}

const vars = parseDeclarations(css)

function color(name) {
  const raw = vars.get(name)
  if (raw === undefined) throw new Error(`token not found in tokens.css: ${name}`)
  return parseColor(raw)
}

/** §8.1 ground recipes, resolved from the declared tokens. */
function ground(spec) {
  if (spec.kind === "token") return color(spec.name)
  if (spec.kind === "acrylic") {
    return composite(color("--glass-tint"), composite(color(spec.tier), BLACK_MEDIA))
  }
  if (spec.kind === "scrim") return composite(color(spec.name), WHITE_MEDIA)
  throw new Error(`unsupported ground: ${spec.kind}`)
}

function foreground(spec, bg) {
  if (spec.kind === "token") return color(spec.name)
  if (spec.kind === "alpha-text") return composite({ ...color(spec.name), a: spec.alpha }, bg)
  throw new Error(`unsupported foreground: ${spec.kind}`)
}

const failures = []
const drifts = []

console.log("[check-contrast]  #  pair                                    computed      §8.2     gate")
for (const pair of PAIRS) {
  let computed
  try {
    const bg = ground(pair.bg)
    computed = contrast(foreground(pair.fg, bg), bg)
  } catch (err) {
    console.error(
      `[check-contrast] FAIL — #${pair.n} ${pair.label}: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }

  const drift = Math.abs(computed - pair.claim) > 0.05
  if (drift) drifts.push({ pair, computed })

  // Compared at §8.2's reported 0.01:1 precision (row 8 computes 2.9953 and
  // §8.2 states it "passes 3.0 exactly").
  const reported = Math.round(computed * 100) / 100

  let gate
  let passed
  if (pair.gate === "min") {
    gate = `>= ${pair.floor.toFixed(1)}`
    passed = reported >= pair.floor
  } else if (pair.gate === "max") {
    gate = `< ${pair.ceiling.toFixed(1)}`
    passed = reported < pair.ceiling
  } else {
    gate = "info"
    passed = true
  }

  const verdict = !passed ? "FAIL" : gate === "info" ? "info" : "ok"
  console.log(
    `[check-contrast] ${String(pair.n).padStart(2)}  ${pair.label.padEnd(38)} ` +
      `${computed.toFixed(2).padStart(6)}:1 ${pair.claim.toFixed(2).padStart(6)}:1  ` +
      `${gate.padEnd(6)} ${verdict}${drift ? " !" : ""}`,
  )
  if (!passed) {
    failures.push(
      `#${pair.n} ${pair.label} — computed ${computed.toFixed(2)}:1, gate ${gate} (§8.2 claims ${pair.claim.toFixed(2)}:1)`,
    )
  }
}

for (const { pair, computed } of drifts) {
  console.log(
    `[check-contrast] drift — #${pair.n} ${pair.label}: computed ${computed.toFixed(2)}:1 vs §8.2 ` +
      `${pair.claim.toFixed(2)}:1 (${Math.abs(computed - pair.claim).toFixed(2)})`,
  )
}

if (failures.length > 0) {
  console.error(`[check-contrast] FAIL — ${failures.length} §8.2 pair(s) outside their gate:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

const gated = PAIRS.filter((pair) => pair.gate !== "info").length
console.log(
  `[check-contrast] ok — ${PAIRS.length} §8.2 pairs checked against tokens.css ` +
    `(${gated} gated, ${PAIRS.length - gated} info-only, ${drifts.length} drift-flagged)`,
)
