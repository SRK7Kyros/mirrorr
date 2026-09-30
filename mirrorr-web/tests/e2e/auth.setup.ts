import { test as setup } from "@playwright/test"
import { STORAGE_STATE } from "../../playwright.config"

// Scaffold: no backend session yet — capture the anonymous state so the
// chromium project always has a valid storage-state file to load. The real
// login flow replaces this in the auth wave.
setup("prepare storage state", async ({ page }) => {
  await page.goto("/")
  await page.context().storageState({ path: STORAGE_STATE })
})
