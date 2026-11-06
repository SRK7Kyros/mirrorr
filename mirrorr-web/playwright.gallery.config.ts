import { defineConfig, devices } from "@playwright/test"
import { VIEWPORTS } from "./tests/visual/scenarios"

/**
 * Evidence-gallery config. Same route-mocked app and the same scenario list as
 * the pixel suite, but the output is the committed audit gallery rather than a
 * baseline comparison.
 *
 * Kept separate so `bun run test:visual` stays an assertion run and
 * `bun run gallery` is the only thing that writes into `docs/`.
 */
const PORT = 5175
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: ["gallery.spec.ts"],
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
