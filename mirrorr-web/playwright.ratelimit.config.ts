import { defineConfig, devices } from "@playwright/test"

/**
 * Isolated rate-limit exhaustion run. `tests/ratelimit/` deliberately burns
 * the REAL per-IP login budget of the dev API (10/min), so it is excluded
 * from the default suite (`bun run test:e2e` only loads `playwright.config.ts`,
 * whose `testDir` is `tests/e2e`).
 *
 * Invocation: `bun run test:ratelimit` — single worker, no stored auth.
 */
const E2E_PORT = 5175
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`

export default defineConfig({
  testDir: "./tests/ratelimit",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /login-exhaust\.spec\.ts/,
    },
  ],
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MIRRORR_BASE: "/" },
  },
})
