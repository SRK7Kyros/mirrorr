#!/usr/bin/env bun
/**
 * check-contrast — recompute WCAG 2.x contrast for every pair the Control Room
 * token layer has to guarantee, against the values actually declared in
 * src/ui/styles/tokens.css.
 *
 * This gate used to read its pair list from docs/console-design-spec.md §8.2.
 * That spec was superseded when the client was rebuilt on the dark Control Room
 * direction, so the pair list below is now owned here: it encodes the floors the
 * palette must hold, not a spec's prose.
 *
 * Method: WCAG 2.x piecewise sRGB relative luminance, (L1 + 0.05) / (L2 + 0.05).
 * Alpha layers are composited in 8-bit over the ground they sit on, exactly as
 * the browser paints them:
 *   - tint fills  = a translucent status/accent fill composited over a surface;
 *   - scrim       = --overlay-scrim composited over the panel behind it;
 *   - alpha text  = the fg alpha composited over its own background.
 *
 * Gates:
 *   min  — must meet the stated floor (text 4.5:1 per 1.4.3, large text and
 *          non-text indicators 3.0:1 per 1.4.11);
 *   max  — the pair must stay *below* the ceiling. Used for combinations that
 *          are banned rather than merely weak: #40 asserts --text on the accent
 *          fill is not readable, which is why --accent-ink exists. A regression
 *          here means a label silently became unreadable.
 *   info — measured and printed but not gated, with the reason stated: the
 *          --text-faint tier (decoration only, documented in tokens.css) and the
 *          1px border tokens (dividers and control boundaries whose identifying
 *          text carries the contrast instead).
 *
 * Exit 1 if any gated row misses its floor/ceiling or tokens.css is unreadable.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const TOKENS_FILE = fileURLToPath(new URL("../src/ui/styles/tokens.css", import.meta.url))

const tok = (name) => ({ kind: "token", name })
const tint = (name, over) => ({ kind: "tint", name, over })
const scrim = (over) => ({ kind: "scrim", over })

/** The palette's guaranteed pairs, with the ratio this gate measured for them. */
const PAIRS = [
  // ---- body text on every surface ----
  { n: 1, label: "--text on --bg", fg: tok("--text"), bg: tok("--bg"), claim: 16.93, gate: "min", floor: 4.5 },
  { n: 2, label: "--text on --bg-sunken", fg: tok("--text"), bg: tok("--bg-sunken"), claim: 17.23, gate: "min", floor: 4.5 },
  { n: 3, label: "--text on --surface-1", fg: tok("--text"), bg: tok("--surface-1"), claim: 15.99, gate: "min", floor: 4.5 },
  { n: 4, label: "--text on --surface-2", fg: tok("--text"), bg: tok("--surface-2"), claim: 15.14, gate: "min", floor: 4.5 },
  { n: 5, label: "--text on --surface-3", fg: tok("--text"), bg: tok("--surface-3"), claim: 14.02, gate: "min", floor: 4.5 },
  { n: 6, label: "--text on --surface-4", fg: tok("--text"), bg: tok("--surface-4"), claim: 12.51, gate: "min", floor: 4.5 },
  { n: 7, label: "--text on --surface-hover", fg: tok("--text"), bg: tok("--surface-hover"), claim: 14.35, gate: "min", floor: 4.5 },

  // ---- secondary text tiers ----
  { n: 8, label: "--text-muted on --surface-1", fg: tok("--text-muted"), bg: tok("--surface-1"), claim: 6.79, gate: "min", floor: 4.5 },
  { n: 9, label: "--text-muted on --surface-2", fg: tok("--text-muted"), bg: tok("--surface-2"), claim: 6.43, gate: "min", floor: 4.5 },
  { n: 10, label: "--text-muted on --bg", fg: tok("--text-muted"), bg: tok("--bg"), claim: 7.19, gate: "min", floor: 4.5 },
  { n: 11, label: "--text-dim on --surface-1", fg: tok("--text-dim"), bg: tok("--surface-1"), claim: 5.9, gate: "min", floor: 4.5 },
  { n: 12, label: "--text-dim on --surface-2", fg: tok("--text-dim"), bg: tok("--surface-2"), claim: 5.59, gate: "min", floor: 4.5 },
  { n: 13, label: "--text-dim on --surface-3", fg: tok("--text-dim"), bg: tok("--surface-3"), claim: 5.17, gate: "min", floor: 4.5 },
  { n: 14, label: "--text-dim on --surface-4", fg: tok("--text-dim"), bg: tok("--surface-4"), claim: 4.62, gate: "min", floor: 4.5 },
  { n: 15, label: "--text-dim on --bg", fg: tok("--text-dim"), bg: tok("--bg"), claim: 6.25, gate: "min", floor: 4.5 },

  // ---- accent as link/label ----
  { n: 16, label: "--accent link on --surface-1", fg: tok("--accent"), bg: tok("--surface-1"), claim: 10.04, gate: "min", floor: 4.5 },
  { n: 17, label: "--accent link on --bg", fg: tok("--accent"), bg: tok("--bg"), claim: 10.63, gate: "min", floor: 4.5 },
  { n: 18, label: "--accent-hover link on --surface-1", fg: tok("--accent-hover"), bg: tok("--surface-1"), claim: 12.63, gate: "min", floor: 4.5 },
  { n: 19, label: "--accent-ink label on --accent", fg: tok("--accent-ink"), bg: tok("--accent"), claim: 9.1, gate: "min", floor: 4.5 },
  { n: 20, label: "--accent-ink label on --accent-hover", fg: tok("--accent-ink"), bg: tok("--accent-hover"), claim: 11.45, gate: "min", floor: 4.5 },
  { n: 21, label: "--text-inverse on --text", fg: tok("--text-inverse"), bg: tok("--text"), claim: 16.93, gate: "min", floor: 4.5 },

  // ---- status indicators as non-text marks ----
  { n: 22, label: "--success mark on --surface-1", fg: tok("--success"), bg: tok("--surface-1"), claim: 7.36, gate: "min", floor: 3 },
  { n: 23, label: "--warning mark on --surface-1", fg: tok("--warning"), bg: tok("--surface-1"), claim: 9.6, gate: "min", floor: 3 },
  { n: 24, label: "--danger mark on --surface-1", fg: tok("--danger"), bg: tok("--surface-1"), claim: 5.57, gate: "min", floor: 3 },
  { n: 25, label: "--info mark on --surface-1", fg: tok("--info"), bg: tok("--surface-1"), claim: 7.4, gate: "min", floor: 3 },
  { n: 26, label: "--secondary mark on --surface-1", fg: tok("--secondary"), bg: tok("--surface-1"), claim: 5.57, gate: "min", floor: 3 },
  { n: 27, label: "--neutral mark on --surface-1", fg: tok("--neutral"), bg: tok("--surface-1"), claim: 6.08, gate: "min", floor: 3 },
  { n: 28, label: "--success mark on --bg", fg: tok("--success"), bg: tok("--bg"), claim: 7.79, gate: "min", floor: 3 },
  { n: 29, label: "--danger mark on --bg", fg: tok("--danger"), bg: tok("--bg"), claim: 5.9, gate: "min", floor: 3 },
  { n: 30, label: "--accent keyline on --surface-2", fg: tok("--accent"), bg: tok("--surface-2"), claim: 9.5, gate: "min", floor: 3 },

  // ---- status ink on its own fill ----
  { n: 31, label: "--success-ink on --success", fg: tok("--success-ink"), bg: tok("--success"), claim: 6.53, gate: "min", floor: 4.5 },
  { n: 32, label: "--warning-ink on --warning", fg: tok("--warning-ink"), bg: tok("--warning"), claim: 8.81, gate: "min", floor: 4.5 },
  { n: 33, label: "--danger-ink on --danger", fg: tok("--danger-ink"), bg: tok("--danger"), claim: 5.54, gate: "min", floor: 4.5 },
  { n: 34, label: "--secondary-ink on --secondary", fg: tok("--secondary-ink"), bg: tok("--secondary"), claim: 5.59, gate: "min", floor: 4.5 },

  // ---- text over tinted status fills ----
  { n: 35, label: "--text on accent-dim over surface-1", fg: tok("--text"), bg: tint("--accent-dim", "--surface-1"), claim: 12.69, gate: "min", floor: 4.5 },
  { n: 36, label: "--text on success-dim over surface-1", fg: tok("--text"), bg: tint("--success-dim", "--surface-1"), claim: 13.07, gate: "min", floor: 4.5 },
  { n: 37, label: "--text on danger-dim over surface-1", fg: tok("--text"), bg: tint("--danger-dim", "--surface-1"), claim: 13.6, gate: "min", floor: 4.5 },

  // ---- text over the overlay scrim ----
  { n: 38, label: "--text on scrim over --surface-2", fg: tok("--text"), bg: scrim("--surface-2"), claim: 16.82, gate: "min", floor: 4.5 },
  { n: 39, label: "--text on scrim over --bg", fg: tok("--text"), bg: scrim("--bg"), claim: 17.33, gate: "min", floor: 4.5 },

  // ---- banned combination ----
  {
    n: 40,
    label: "--text on --accent (BANNED)",
    fg: tok("--text"),
    bg: tok("--accent"),
    claim: 1.59,
    gate: "max",
    ceiling: 4.5,
    note: "accent fills must carry --accent-ink, never --text",
  },

  // ---- measured but not gated ----
  {
    n: 41,
    label: "--text-faint on --surface-1",
    fg: tok("--text-faint"),
    bg: tok("--surface-1"),
    claim: 2.24,
    gate: "info",
    note: "decoration-only tier — never bind it to meaningful copy",
  },
  {
    n: 42,
    label: "--border on --surface-1",
    fg: tok("--border"),
    bg: tok("--surface-1"),
    claim: 1.31,
    gate: "info",
    note: "1px divider — 1.4.11 exempt; the adjacent text carries the contrast",
  },
  {
    n: 43,
    label: "--border-strong on --surface-2",
    fg: tok("--border-strong"),
    bg: tok("--surface-2"),
    claim: 1.58,
    gate: "info",
    note: "control boundary — identified by its label, not the hairline",
  },
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

/** 8-bit alpha composite, matching how the browser paints tint/scrim layers. */
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

function ground(spec) {
  if (spec.kind === "token") return color(spec.name)
  if (spec.kind === "tint") return composite(color(spec.name), color(spec.over))
  if (spec.kind === "scrim") return composite(color("--overlay-scrim"), color(spec.over))
  throw new Error(`unsupported ground: ${spec.kind}`)
}

const failures = []
const drifts = []

console.log("[check-contrast]  #  pair                                      computed     pinned   gate")
for (const pair of PAIRS) {
  let computed
  try {
    const bg = ground(pair.bg)
    computed = contrast(color(pair.fg.name), bg)
  } catch (err) {
    console.error(
      `[check-contrast] FAIL — #${pair.n} ${pair.label}: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }

  const drift = Math.abs(computed - pair.claim) > 0.05
  if (drift) drifts.push({ pair, computed })

  // Compared at the 0.01:1 precision the pinned claims were measured at.
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
    `[check-contrast] ${String(pair.n).padStart(2)}  ${pair.label.padEnd(40)} ` +
      `${computed.toFixed(2).padStart(6)}:1 ${pair.claim.toFixed(2).padStart(6)}:1  ` +
      `${gate.padEnd(6)} ${verdict}${drift ? " !" : ""}`,
  )
  if (pair.gate === "info" && pair.note !== undefined) {
    console.log(`[check-contrast]     — ${pair.note}`)
  }
  if (!passed) {
    failures.push(
      `#${pair.n} ${pair.label} — computed ${computed.toFixed(2)}:1, gate ${gate} (pinned ${pair.claim.toFixed(2)}:1)`,
    )
  }
}

for (const { pair, computed } of drifts) {
  console.log(
    `[check-contrast] drift — #${pair.n} ${pair.label}: computed ${computed.toFixed(2)}:1 vs pinned ` +
      `${pair.claim.toFixed(2)}:1 (${Math.abs(computed - pair.claim).toFixed(2)})`,
  )
}

if (failures.length > 0) {
  console.error(`[check-contrast] FAIL — ${failures.length} pair(s) outside their gate:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

const gated = PAIRS.filter((pair) => pair.gate !== "info").length
console.log(
  `[check-contrast] ok — ${PAIRS.length} pairs checked against tokens.css ` +
    `(${gated} gated, ${PAIRS.length - gated} info-only, ${drifts.length} drift-flagged)`,
)
