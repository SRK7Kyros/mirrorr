#!/usr/bin/env bun
/**
 * Contrast recomputation (WCAG 2.x relative luminance).
 *
 * The accessibility floor states a contrast table; a stated ratio is a claim, not
 * a measurement. This reads the token values out of the BUILT CSS (dist/assets/*.css,
 * so a minifier transform or a token edit is what is measured), composites any
 * translucent chip background over its parent surface, recomputes each pair and
 * compares it to the claimed minimum in tests/fixtures/contrast.spec.json.
 *
 * Run `bun run build` first. A pair passes only when the measurement meets or
 * exceeds the claim; the script never adjusts the claim.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const fixturePath = join(root, "tests", "fixtures", "contrast.spec.json")
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"))

const assetsDir = join(root, "dist", "assets")
if (!existsSync(assetsDir)) {
  console.error("check-contrast: dist/assets is missing - run `bun run build` first.")
  process.exit(2)
}

const cssFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".css"))
if (cssFiles.length === 0) {
  console.error("check-contrast: no CSS found in dist/assets - run `bun run build` first.")
  process.exit(2)
}

const css = cssFiles.map((name) => readFileSync(join(assetsDir, name), "utf8")).join("\n")

/** Every `--name: value` declaration in the built CSS; last one wins (the cascade's end). */
const tokens = new Map()
for (const match of css.matchAll(/--([a-zA-Z][\w-]*)\s*:\s*([^;{}]+)(?=[;}])/g)) {
  tokens.set(`--${match[1]}`, match[2].trim())
}

function toRgb(raw) {
  const value = raw.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)
  if (hex !== null) {
    let digits = hex[1]
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((char) => char + char).join("")
    }
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/.exec(value)
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

function composite(fg, bg, alpha) {
  return fg.map((channel, index) => alpha * channel + (1 - alpha) * bg[index])
}

function linear(channel) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrastRatio(a, b) {
  const first = luminance(a)
  const second = luminance(b)
  const [hi, lo] = first >= second ? [first, second] : [second, first]
  return (hi + 0.05) / (lo + 0.05)
}

function resolve(name) {
  const raw = tokens.get(name)
  if (raw === undefined) return null
  const rgb = toRgb(raw)
  if (rgb === null) {
    console.error(`check-contrast: ${name} is not a colour (${raw})`)
    process.exit(2)
  }
  return rgb
}

const rows = []
const failures = []
const notes = []

for (const pair of fixture.pairs) {
  const fg = resolve(pair.fg)
  const surface = resolve(pair.bg)
  if (fg === null || surface === null) {
    failures.push(`${pair.name}: token missing (${fg === null ? pair.fg : pair.bg})`)
    continue
  }
  let background = surface
  if (pair.overlay !== undefined) {
    const overlay = resolve(pair.overlay.color)
    if (overlay === null) {
      failures.push(`${pair.name}: overlay token missing (${pair.overlay.color})`)
      continue
    }
    background = composite(overlay, surface, pair.overlay.alpha)
  }
  const measured = contrastRatio(fg, background)
  const meetsFloor = measured + 0.05 >= pair.min
  const meetsClaim = measured + 0.05 >= pair.claimed
  rows.push({
    name: pair.name,
    measured: measured.toFixed(2),
    claimed: pair.claimed.toFixed(1),
    verdict: meetsFloor ? (meetsClaim ? "ok" : "below claim") : "FAIL",
  })
  if (!meetsFloor) {
    failures.push(`${pair.name}: measured ${measured.toFixed(2)}:1, floor ${pair.min.toFixed(1)}:1`)
  }
  if (!meetsClaim) {
    notes.push(
      `${pair.name}: measured ${measured.toFixed(2)}:1 against the spec's stated ${pair.claimed.toFixed(1)}:1`,
    )
  }
}

const width = Math.max(...rows.map((row) => row.name.length), "pair".length)
console.log(`check-contrast: built css   ${cssFiles.join(", ")}`)
console.log(`check-contrast: fixture     ${relative(root, fixturePath)}`)
console.log(`check-contrast: source      ${fixture.source}`)
console.log(`${"pair".padEnd(width)}  measured  claimed  verdict`)
for (const row of rows) {
  console.log(`${row.name.padEnd(width)}  ${row.measured.padStart(8)}  ${row.claimed.padStart(7)}  ${row.verdict}`)
}

const metClaim = rows.filter((row) => row.verdict !== "below claim" && row.verdict !== "FAIL").length
console.log(
  `check-contrast: ${metClaim}/${rows.length} pairs meet or exceed the spec's stated ratio`,
)

for (const note of notes) console.log(`below-claim: ${note}`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  console.error(`check-contrast: FAILED - ${failures.length} pair(s) below the enforced floor`)
  process.exit(1)
}

console.log(
  `(every pair recomputed from the built tokens clears its floor - ${rows.length} pairs, ${notes.length} below the spec's stated ratio)`,
)
