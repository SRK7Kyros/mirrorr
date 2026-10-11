#!/usr/bin/env bun
/**
 * Collision guard — Phase 0 of the Tailwind migration.
 *
 * Tailwind v4's scanner harvests class candidates from *any* string literal in
 * the source tree (framer-motion `initial`/`animate` props, `aria-*` values,
 * plain strings). If a harvested candidate also names a class this project
 * defines in `src/ui/styles/*.css`, two rules exist for the same class name.
 * This project's CSS is unlayered so it wins today, but a silent overlap is
 * exactly what lets one surface drift later.
 *
 * The guard reads the *built* stylesheet (so it sees what Tailwind actually
 * emitted), extracts the class names Tailwind generated into its
 * `@layer utilities` block, and intersects them with the class names authored
 * here. Anything outside the allowlist is a defect.
 *
 * Requires a fresh `bun run build` (reads `dist/assets/*.css`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const STYLES = join(ROOT, "src/ui/styles")
const DIST_ASSETS = join(ROOT, "dist/assets")

/**
 * Reviewed overlaps. Both are already defined by this project's CSS (unlayered,
 * so it wins) and both are emitted only because the bare string appears in
 * source. Re-review if either stops being defined here.
 */
const KNOWN = new Map([
  ["table", "Table.tsx passes the literal class \"table\""],
  ["sr-only", "Switch.tsx uses the literal class \"sr-only\""],
])

const CLASS_RE = /\.((?:[a-zA-Z0-9_-]|\\.)+)/g

/** Class names appearing in selector position (declarations/comments dropped). */
function classNames(css) {
  const names = new Set()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of clean.split("}")) {
    const prelude = chunk.split("{")[0]
    for (const match of prelude.matchAll(CLASS_RE)) {
      const name = match[1].replace(/\\/g, "")
      if (/^[a-zA-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

/** Bodies of every `@layer <name>{…}` block, brace-matched. */
function layerBodies(css, layer) {
  const bodies = []
  const re = new RegExp(`@layer\\s+${layer}\\s*\\{`, "g")
  let match
  while ((match = re.exec(css)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++
      else if (css[i] === "}") depth--
      i++
    }
    bodies.push(css.slice(start, i - 1))
  }
  return bodies
}

const authored = new Set()
for (const file of readdirSync(STYLES).filter((f) => f.endsWith(".css"))) {
  for (const name of classNames(readFileSync(join(STYLES, file), "utf8"))) authored.add(name)
}

if (!existsSync(DIST_ASSETS)) {
  console.error("✗ dist/assets/ missing — run `bun run build` first.")
  process.exit(1)
}
const bundle = readdirSync(DIST_ASSETS)
  .filter((f) => f.endsWith(".css"))
  .map((f) => join(DIST_ASSETS, f))
  .sort()
  .pop()

const tailwind = new Set()
for (const body of layerBodies(readFileSync(bundle, "utf8"), "utilities")) {
  for (const name of classNames(body)) tailwind.add(name)
}

const collisions = [...authored].filter((name) => tailwind.has(name)).sort()
const unexpected = collisions.filter((name) => !KNOWN.has(name))
const stale = [...KNOWN.keys()].filter((name) => !collisions.includes(name))

console.log(`authored classes: ${authored.size} · tailwind utilities emitted: ${tailwind.size}`)
console.log(`overlaps: ${collisions.length ? collisions.join(", ") : "none"}`)
if (stale.length) console.log(`allowlist entries no longer colliding: ${stale.join(", ")}`)

if (unexpected.length) {
  console.error(`\n✗ ${unexpected.length} unreviewed class collision(s): ${unexpected.join(", ")}`)
  console.error("  A Tailwind utility and a project class share a name. Either rename")
  console.error("  the project class, stop emitting the utility, or allowlist it in KNOWN above.")
  process.exit(1)
}
console.log("\n✓ no unreviewed collisions")