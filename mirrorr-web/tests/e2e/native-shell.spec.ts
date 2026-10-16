import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * The console also runs inside the phone app's web view. Capacitor injects
 * `window.Capacitor` into the main frame of every page it loads — remote
 * origins included — so these specs install a fake bridge to cover both sides
 * of that seam: native-only affordances appear, and a browser never sees them.
 * The keychain answers only for its own origin's key, so a console that asked
 * for the wrong one would come back empty here exactly as it would on a phone.
 * The picker's record names the host this console was opened from, which is
 * what the account menu's Server block renders.
 */
async function installShell(page: Page, credential: string | null = null): Promise<void> {
  await page.addInitScript((stored: string | null) => {
    const pageOrigin = (globalThis as unknown as { location: { origin: string } }).location.origin
    const Plugins: Record<string, unknown> = {
      Preferences: {
        get: async (options: { key: string }) => ({
          value:
            options.key === "mirrorr.servers.v1"
              ? JSON.stringify({
                  servers: [
                    { name: "Studio box", url: pageOrigin },
                    { name: "Spare box", url: "https://spare.example/" },
                  ],
                  autoUrl: null,
                })
              : null,
        }),
      },
    }
    if (stored !== null) {
      Plugins["SecureStorage"] = {
        internalGetItem: async (options: { prefixedKey: string }) => ({
          data: options.prefixedKey === `capacitor-storage_mirrorr.cred.${pageOrigin}` ? stored : null,
        }),
      }
    }
    ;(globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, Plugins }
  }, credential)
}

const CREDENTIAL = JSON.stringify({ username: "kyros", password: "s3cret" })

test.describe("native shell", () => {
  test("a browser is offered no way back to a server list", async ({ page }) => {
    await page.goto("/settings")

    await page.getByRole("button", { name: "Account menu" }).click()

    await expect(page.getByRole("menuitem", { name: "Switch server" })).toHaveCount(0)
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
  })

  test("the app's account menu links back to the picker", async ({ page }) => {
    await installShell(page)
    await page.goto("/settings")

    await page.getByRole("button", { name: "Account menu" }).click()

    await expect(page.getByRole("menuitem", { name: "Switch server" })).toHaveAttribute(
      "href",
      "capacitor://localhost/",
    )
    await expect(page.getByText("Studio box")).toBeVisible()
  })

  test("saved credentials sign in without the form", async ({ page, api }) => {
    api.data.authenticated = false
    await installShell(page, CREDENTIAL)

    await page.goto("/")

    // The stub user is an admin, whose home is the admin console — a second
    // build, so the hop is a document navigation the dev server answers with
    // the SPA fallback: the URL is what proves the redirect happened.
    await expect(page).toHaveURL(/\/admin\/settings$/)
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
