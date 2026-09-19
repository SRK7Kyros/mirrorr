import { describe, expect, it } from "vitest"

/**
 * Token discipline: colour lives in src/styles.css tokens only. Components
 * consume token utilities/vars, so no literal hex may appear in src/**\/*.tsx.
 * (scripts/check-tokens.mjs separately diffs the built CSS against the frozen
 * fixture tests/fixtures/tokens.spec.json.)
 *
 * Sources are loaded with Vite's raw glob so the app tsconfig (which carries no
 * node types) can type-check this test as well as run it under Vitest.
 */
const COMPONENT_SOURCES = import.meta.glob("./**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/

describe("token discipline", () => {
  it("keeps literal hex colours out of src/**/*.tsx", () => {
    const offenders = Object.entries(COMPONENT_SOURCES).flatMap(([file, source]) =>
      source
        .split("\n")
        .flatMap((line, index) => (HEX_LITERAL.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
    )

    expect(offenders).toEqual([])
  })
})
