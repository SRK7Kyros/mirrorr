import { defineConfig, devices } from "@playwright/test"

/**
 * Visual-regression harness (Phase 0 of the Tailwind/shadcn migration).
 *
 * Separate from the behavioural suite: it drives the same route-mocked app but
 * asserts *pixels*, so it can answer "did this refactor change what the user
 * sees?" — the question the migration audit says is currently unanswerable.
 *
 * Determinism rules:
 *   - dark only (`colorScheme: "dark"`); the app has no light theme.
 *   - `reducedMotion: "reduce"` so CSS transitions/animations never mid-flight.
 *   - `animations: "disabled"` in the screenshot matcher (belt and braces).
 *   - the spec pins the clock (`page.clock.setFixedTime`) so relative-time text
 *     ("12m ago", live durations) cannot tick between runs.
 *   - one snapshot per (route, viewport) under `tests/visual/__screenshots__`.
 *
 * Baseline flow: generate with `--update-snapshots` on `main`, copy the
 * `__screenshots__` dir onto the branch under test, then run without the flag
 * to diff. See `docs/shadcn-tailwind-migration-audit.md` §1.
 */
const PORT = 5175
const BASE_URL = `http://127.0.0.1:${PORT}`

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  workers: 2,
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations; hide the text caret; CSS-pixel scale keeps the
      // output independent of device pixel ratio.
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Anti-aliasing tolerance. Identical CSS renders identically, so the
      // Tailwind scaffold diffs clean; anything perceptible must exceed this.
      maxDiffPixelRatio: 0.001,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: BASE_URL,
    reducedMotion: "reduce",
    colorScheme: "dark",
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects: VIEWPORTS.map((viewport) => ({
    name: `v${viewport.name}`,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: viewport.width, height: viewport.height },
    },
  })),
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MIRRORR_BASE: "/" },
  },
})