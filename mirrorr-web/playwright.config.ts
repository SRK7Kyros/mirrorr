import fs from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

/**
 * Canonical Playwright storage-state path. The auth setup (later step) writes
 * here; contexts load it once it exists.
 */
export const STORAGE_STATE = path.join(import.meta.dirname, ".playwright/auth.json")

/**
 * Playwright-managed dev-server port. 5175 is the greenfield app's port; port
 * 5174 belongs to the legacy dev unit and must never be used by tests.
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
    // Until the auth setup lands there is no stored state to load.
    ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
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
