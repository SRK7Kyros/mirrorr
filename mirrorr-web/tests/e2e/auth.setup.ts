import { expect, test as setup } from "@playwright/test"
import { STORAGE_STATE } from "../../playwright.config"

/**
 * The single real login POST of the default suite: seeded admin credentials
 * (source-verified in `dev/mirrorr-core.service` → `--dev-seed-admin`). Saves
 * the httpOnly cookies every browser project reuses.
 */
setup("authenticate as the seeded admin", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Username").fill("admin")
  await page.getByLabel("Password", { exact: true }).fill("admin123")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/sessions$/)
  await expect(page.getByTestId("sessions-view")).toBeVisible()

  await page.context().storageState({ path: STORAGE_STATE })
})
