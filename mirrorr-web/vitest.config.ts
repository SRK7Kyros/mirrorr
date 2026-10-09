import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  // Must match vite.config.ts: the admin-only schema fields branch on this
  // compile-time constant, so tests would throw on an undefined global.
  define: { __ADMIN__: "false" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Unit/component specs only. Playwright specs live in tests/e2e and are
    // intentionally outside this glob so `vitest run` never drives a browser.
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
  },
})
