import { defineConfig, devices } from "@playwright/test"

/**
 * Route-mocked browser suite.
 *
 * Every spec fulfils `**\/api/**` from `tests/e2e/fixtures.ts`, so the suite
 * needs no core process, no database and no seeded login: the SPA boots against
 * stubbed responses and each spec navigates as the principal it wants. The only
 * real moving part is the Vite dev server, which Playwright starts below.
 *
 * Playwright-managed dev-server port. 5175 is this app's strict port; 5173
 * and 5174 belong to other apps and must never be used by tests.
 */
const E2E_PORT = 5175
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MIRRORR_BASE: "/" },
  },
})
