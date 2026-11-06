import { defineConfig, devices } from "@playwright/test"
import { VIEWPORTS } from "./tests/visual/scenarios"

/**
 * Accessibility config: axe + the WCAG 2.2 target-size criterion across the
 * same scenario list the gallery and pixel suites use. One width is not enough —
 * the console reflows at 768, and a control that is 40 px on a desktop can be
 * 18 px on a phone.
 */
const PORT = 5175
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./tests/visual",
  // Two gates, one server: accessibility (all widths) and the fact inventory
  // (one width — the facts are not width-dependent).
  testMatch: ["a11y.spec.ts", "fact-inventory.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  workers: 2,
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    reducedMotion: "reduce",
    colorScheme: "dark",
  },
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
