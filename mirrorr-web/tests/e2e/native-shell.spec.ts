import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * The console also runs inside the phone app's web view. Capacitor injects
 * `window.Capacitor` into the main frame of every page it loads — remote
 * origins included — so these specs install a fake bridge to cover both sides
 * of that seam: native-only affordances appear, and a browser never sees them.
 */
async function installShell(page: Page, credential: string | null = null): Promise<void> {
  await page.addInitScript((stored: string | null) => {
    const Plugins: Record<string, unknown> = {}
    if (stored !== null) Plugins["SecureStorage"] = { get: async () => stored }
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, Plugins }
  }, credential)
}

const CREDENTIAL = JSON.stringify({ username: "kyros", password: "s3cret" })

test.describe("native shell", () => {
  test("a browser is offered no way back to a server list", async ({ page }) => {
    await page.goto("/settings")

    await page.getByRole("button", { name: "Account menu" }).click()

    await expect(page.getByRole("menuitem", { name: "Servers" })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
  })

  test("the app's account menu links back to the picker", async ({ page }) => {
    await installShell(page)
    await page.goto("/settings")

    await page.getByRole("button", { name: "Account menu" }).click()

    await expect(page.getByRole("menuitem", { name: "Servers" })).toHaveAttribute(
      "href",
      "capacitor://localhost/",
    )
  })

  test("saved credentials sign in without the form", async ({ page, api }) => {
    api.data.authenticated = false
    await installShell(page, CREDENTIAL)

    await page.goto("/")

    await expect(page).toHaveURL(/\/sessions$/)
    expect(api.callsTo("/auth/login")).toHaveLength(1)
  })

  test("rejected credentials fall back to the form, without retrying", async ({ page, api }) => {
    api.data.authenticated = false
    api.data.loginFails = true
    await installShell(page, CREDENTIAL)

    await page.goto("/")

    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
    await expect(page.getByText("Saved credentials were rejected — sign in below.")).toBeVisible()
    expect(api.callsTo("/auth/login")).toHaveLength(1)
  })
})
