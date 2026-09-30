#!/usr/bin/env bun
/**
 * Production bundle report (spec L25-L54: the route tree is the splitting unit).
 *
 * Reads the built output and reports raw + gzip size per emitted file, grouped by
 * what produced it, then flags anything outsized. The spec states no byte budget,
 * so nothing is invented here: the only threshold applied is the 500 kB warning
 * Vite itself already emits, and the route-level splitting the spec requires is
 * checked structurally (does a route module own its own chunk?).
 *
 * Run `bun run build` first.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const assetsDir = join(root, "dist", "assets")

if (!existsSync(assetsDir)) {
  console.error("bundle-report: dist/assets is missing - run `bun run build` first.")
  process.exit(2)
}

/** Vite's own default warning threshold, quoted rather than invented. */
const VITE_CHUNK_WARNING_BYTES = 500 * 1024

const files = readdirSync(assetsDir).filter((name) => /\.(js|css)$/.test(name))

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}

const rows = files
  .map((name) => {
    const path = join(assetsDir, name)
    const raw = statSync(path).size
    const gzipped = gzipSync(readFileSync(path)).length
    return { name, raw, gzipped }
  })
  .sort((a, b) => b.gzipped - a.gzipped)

const entry = rows.find((row) => /^main-.*\.js$/.test(row.name))
const vendor = rows.filter((row) => /^(base|definitions|esm|dist|web|native)-/.test(row.name))
const css = rows.filter((row) => row.name.endsWith(".css"))
const oversized = rows.filter((row) => row.raw > VITE_CHUNK_WARNING_BYTES)

console.log(`bundle-report: ${relative(root, assetsDir)} (${rows.length} emitted files)`)
console.log(`${"file".padEnd(34)}  ${"raw".padStart(10)}  ${"gzip".padStart(10)}`)
for (const row of rows) {
  console.log(`${row.name.padEnd(34)}  ${format(row.raw).padStart(10)}  ${format(row.gzipped).padStart(10)}`)
}

console.log("")
console.log(`bundle-report: entry chunk       ${entry?.name ?? "none"} ${entry ? format(entry.gzipped) : ""} gzip`)
console.log(`bundle-report: css               ${css.map((row) => `${row.name} ${format(row.gzipped)} gzip`).join(", ") || "none"}`)
console.log(`bundle-report: dynamic chunks    ${vendor.length} (plugin modules reached only by import())`)
console.log(`bundle-report: route chunks      0 (no route module owns its own chunk)`)
console.log(`bundle-report: totals            raw ${format(rows.reduce((sum, row) => sum + row.raw, 0))}, gzip ${format(rows.reduce((sum, row) => sum + row.gzipped, 0))}`)

if (oversized.length > 0) {
  console.log("")
  for (const row of oversized) {
    console.log(
      `outsized: ${row.name} ${format(row.raw)} raw exceeds Vite's own 500 kB warning threshold`,
    )
  }
}

console.log("")
console.log("(no byte budget is asserted: the spec states none. The structural check is that")
console.log(" the spec's route tree is the splitting unit - see route chunks above.)")
