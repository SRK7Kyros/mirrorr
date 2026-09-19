#!/usr/bin/env bun
/**
 * Mechanical token diff.
 *
 * Every custom property frozen in tests/fixtures/tokens.spec.json (transcribed
 * from docs/web-frontend-spec.md L55-L113) must be present, with the spec's
 * value, in the built CSS (dist/assets/*.css). Run `bun run build` first.
 *
 * Values are normalized only for case, whitespace, quote style and colour
 * syntax (hex <-> rgba) so minifier transforms cannot hide a real mismatch.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const fixturePath = join(root, "tests", "fixtures", "tokens.spec.json")
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"))
const required = fixture.tokens

const assetsDir = join(root, "dist", "assets")

if (!existsSync(assetsDir)) {
  console.error("check-tokens: dist/assets is missing - run `bun run build` first.")
  process.exit(2)
}

const cssFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".css"))

if (cssFiles.length === 0) {
  console.error("check-tokens: no CSS found in dist/assets - run `bun run build` first.")
  process.exit(2)
}

const css = cssFiles.map((name) => readFileSync(join(assetsDir, name), "utf8")).join("\n")

/** Collect every `--name: value` declaration from the built CSS. */
const found = new Map()
for (const match of css.matchAll(/--([a-zA-Z][\w-]*)\s*:\s*([^;{}]+)(?=[;}])/g)) {
  const name = `--${match[1]}`
  const value = match[2].trim()
  if (!found.has(name)) found.set(name, [])
  found.get(name).push(value)
}

const HEX = /#([0-9a-fA-F]{3,8})\b/g
const RGB = /rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.]+)\s*)?\)/gi

/** Canonical colour form: lowercase 8-digit hex (#rrggbbaa), so hex and rgba() compare equal. */
function canonicalColor(r, g, b, a) {
  const alpha = a === undefined ? 255 : Math.round(Number(a) * 255)
  return `#${[r, g, b]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}${alpha.toString(16).padStart(2, "0")}`
}

function canonicalHex(hex) {
  let value = hex.toLowerCase()
  if (value.length === 3 || value.length === 4) {
    value = [...value].map((char) => char + char).join("")
  }
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) : 255
  return `#${[...channels, alpha].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

function normalize(raw) {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["']/g, "")
    // Milliseconds and seconds are the same value written two ways (120ms == .12s).
    .replace(/(-?\d*\.?\d+)(ms|s)\b/g, (_, n, unit) => `${Number(n) * (unit === "s" ? 1000 : 1)}ms`)
    // Minifiers strip the leading zero (.12s, .04em).
    .replace(/(?<![\d.])\.(\d+)/g, "0.$1")
    .replace(HEX, (_, hex) => canonicalHex(hex))
    .replace(RGB, (_, r, g, b, a) => canonicalColor(r, g, b, a))
    .trim()
}

const diffs = []
for (const [name, expectedRaw] of Object.entries(required)) {
  const candidates = found.get(name)
  if (!candidates) {
    diffs.push(`- ${name}: ${expectedRaw} (missing from built CSS)`)
    continue
  }
  const expected = normalize(expectedRaw)
  if (!candidates.some((candidate) => normalize(candidate) === expected)) {
    diffs.push(`- ${name}: ${expectedRaw} (found: ${candidates.join(" | ")})`)
  }
}

const total = Object.keys(required).length
const relativeFixture = relative(root, fixturePath)

console.log(`check-tokens: fixture       ${relativeFixture}`)
console.log(`check-tokens: built css     ${cssFiles.join(", ")}`)
console.log(`check-tokens: tokens matched ${total - diffs.length}/${total}`)
console.log(`--- ${relativeFixture}`)
console.log(`+++ dist/assets/${cssFiles.join(", dist/assets/")}`)

if (diffs.length > 0) {
  for (const line of diffs) console.log(line)
  console.error(`check-tokens: FAILED - ${diffs.length} token(s) missing or mismatched`)
  process.exit(1)
}

console.log("(diff is empty - every spec token is present with its spec value)")
