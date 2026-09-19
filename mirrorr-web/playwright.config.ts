import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

/**
 * Canonical storage-state path. The `setup` project writes it after one real
 * login; every browser project loads it. Gitignored (`.playwright/`).
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
    // Written by the `setup` project; unconditional since todo 8.
    storageState: STORAGE_STATE,
  },
  projects: [
    {
      name: "setup",
      // The setup login must start logged out even if a stale state file exists.
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
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
