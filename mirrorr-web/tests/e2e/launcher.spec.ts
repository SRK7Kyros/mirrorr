import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"

/**
 * The server picker is the shell's own page (no console, no API), so it is
 * served from disk here — `launcher/` is static, and a route stub keeps a
 * second dev server out of the suite. Its two native stores are faked over one
 * `Map` so the real code path runs: `@capacitor/preferences` for the host list
 * and the keychain for credentials.
 */
const LAUNCHER_DIR = new URL("../../mobile/launcher/", import.meta.url)
const LAUNCHER = "http://launcher.test/index.html"

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
}

async function serveLauncher(page: Page): Promise<void> {
  await page.route("http://launcher.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html"
    const file = new URL(path, LAUNCHER_DIR)
    await route.fulfill({
      contentType: CONTENT_TYPES[file.pathname.split(".").pop() ?? ""] ?? "application/octet-stream",
      body: readFileSync(file).toString(),
    })
  })
}

const HOST = "https://mirrorr.example.org"
const CREDENTIAL_KEY = `mirrorr.cred.${HOST}`
// What the plugin actually stores it under — the prefix is part of the contract.
const KEYCHAIN_KEY = `capacitor-storage_${CREDENTIAL_KEY}`
const SERVERS_KEY = "mirrorr.servers.v1"

async function keysIn(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from((globalThis as { __store?: Map<string, string> }).__store?.keys() ?? []),
  )
}

async function entryIn(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (wanted) => (globalThis as { __store?: Map<string, string> }).__store?.get(wanted) ?? null,
    key,
  )
}

test.beforeEach(async ({ page }) => {
  await serveLauncher(page)
  await page.addInitScript(() => {
    const store = new Map<string, string>()
    ;(globalThis as { __store?: Map<string, string> }).__store = store
    ;(globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Preferences: {
          get: async (options: { key: string }) => ({ value: store.get(options.key) ?? null }),
          set: async (options: { key: string; value: string }) => void store.set(options.key, options.value),
        },
        // The plugin's real bridge contract: one options object, with the key
        // already carrying its `capacitor-storage_` prefix.
        SecureStorage: {
          internalGetItem: async (options: { prefixedKey: string }) => ({
            data: store.get(options.prefixedKey) ?? null,
          }),
          internalSetItem: async (options: { prefixedKey: string; data: string }) =>
            void store.set(options.prefixedKey, options.data),
          internalRemoveItem: async (options: { prefixedKey: string }) =>
            void store.delete(options.prefixedKey),
        },
      },
    }
  })

  await page.goto(LAUNCHER)
})

test.describe("server picker", () => {
  test("adds a host, and keeps its password out of the host list", async ({ page }) => {
    await page.getByLabel("Server URL").fill(HOST)
    await page.getByLabel("Name (optional)", { exact: true }).fill("Home server")
    await page.getByLabel("Username (optional)", { exact: true }).fill("kyros")
    await page.getByLabel("Password (optional)", { exact: true }).fill("s3cret")
    await page.getByRole("button", { name: "Add server" }).click()

    await expect(page.locator(".connect .name")).toContainText("Home server")
    await expect(page.locator(".connect .badge-login")).toHaveText("kyros")

    await expect.poll(() => entryIn(page, KEYCHAIN_KEY)).toBe(JSON.stringify({ username: "kyros", password: "s3cret" }))
    const servers = await entryIn(page, SERVERS_KEY)
    expect(servers).toContain(HOST)
    expect(servers).not.toContain("s3cret")
  })

  test("editing a host prefills what was saved, and renames it", async ({ page }) => {
    await page.getByLabel("Server URL").fill(HOST)
    await page.getByLabel("Username (optional)", { exact: true }).fill("kyros")
    await page.getByLabel("Password (optional)", { exact: true }).fill("s3cret")
    await page.getByRole("button", { name: "Add server" }).click()
    await expect(page.locator(".connect .name")).toBeVisible()

    await page.getByRole("button", { name: `Edit ${HOST}` }).click()

    await expect(page.getByLabel("Username (optional)", { exact: true })).toHaveValue("kyros")
    await expect(page.getByLabel("Password (optional)", { exact: true })).toHaveValue("s3cret")

    await page.getByLabel("Name (optional)", { exact: true }).fill("Attic")
    await page.getByRole("button", { name: "Save changes" }).click()

    await expect(page.locator(".connect .name")).toContainText("Attic")
    await expect(page.locator(".server")).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Add server" })).toBeVisible()
  })

  test("removing a host takes its credentials with it", async ({ page }) => {
    await page.getByLabel("Server URL").fill(HOST)
    await page.getByLabel("Username (optional)", { exact: true }).fill("kyros")
    await page.getByLabel("Password (optional)", { exact: true }).fill("s3cret")
    await page.getByRole("button", { name: "Add server" }).click()
    await expect(page.locator(".connect .name")).toBeVisible()

    await page.getByRole("button", { name: `Remove ${HOST}` }).click()

    await expect(page.locator(".server")).toHaveCount(0)
    await expect(page.getByText("No servers yet — add one below.")).toBeVisible()
    await expect.poll(() => keysIn(page)).not.toContain(KEYCHAIN_KEY)
  })
})
